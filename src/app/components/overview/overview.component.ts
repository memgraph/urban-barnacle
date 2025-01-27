import { AfterContentInit, Component } from '@angular/core';
import { Store } from '@ngrx/store';
import { BehaviorSubject, combineLatest, map, Observable } from 'rxjs';
import {
  DatasetSize,
  IBenchmark,
  IPercentages,
  IQueryIsolated,
  IQueryMixed,
  isQueryIsolated,
  isQueryMixed,
  isWorkloadIsolated,
  isWorkloadMixed,
  isWorkloadRealistic,
  IWorkload,
  IWorkloadIsolated,
  IWorkloadMixed,
  Platform,
  QueryCategory,
  RunConfigCondition,
  RunConfigVendor,
  WorkloadType,
} from 'src/app/models/benchmark.model';
import { AppState } from 'src/app/state';
import { BenchmarkSelectors } from 'src/app/state/benchmarks';
import _ from 'lodash';
import { filterNullish } from 'src/app/services/filter-nullish';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { LATENCY_PERCENTILE } from 'src/app/state/benchmarks/benchmarks.effects';
import { SegmentService } from 'src/app/services/segment.service';
import { TUTORIAL_LINK } from '../sidenav/sidenav.component';

export enum ITab {
  AGGREGATE = 'Aggregate Results',
  GLOBAL = 'Global Results',
  DETAILED = 'Detailed Results',
}

export interface IStat {
  value: number;
  isWeakest: boolean;
  relativeValue: number;
}

export interface IStatsResultTypes {
  memory: IStat;
  throughput: IStat;
}

export type IStatsResultTypesIsolated = IStatsResultTypes & { latency: IStat };

export enum ResultType {
  MEMORY = 'memory',
  THROUGHPUT = 'throughput',
  LATENCY = 'latency',
}

export interface ResultTypeWithUnit {
  name: string;
  unit: string;
}

export const RESULT_TYPE_BY_KEY: Record<keyof IStatsResultTypesIsolated, ResultTypeWithUnit> = {
  [ResultType.LATENCY]: { name: 'Latency', unit: 'millisec' },
  [ResultType.MEMORY]: { name: 'Peak Memory', unit: 'MiB' },
  [ResultType.THROUGHPUT]: { name: 'Throughput', unit: 'Q/s' },
};

export const STAT_VENDOR_KEYS: (keyof IStatsResultTypesIsolated)[] = [
  ResultType.THROUGHPUT,
  ResultType.MEMORY,
  ResultType.LATENCY,
];

export const STAT_VENDOR_KEYS_WITHOUT_LATENCY: (keyof IStatsResultTypes)[] = [ResultType.THROUGHPUT, ResultType.MEMORY];

export type IStatsByVendor = {
  vendor: RunConfigVendor;
  percentages: IPercentages | undefined;
} & IStatsResultTypes;

export type IStatsByVendorIsolated = {
  vendor: RunConfigVendor;
} & IStatsResultTypesIsolated;

export function isStatsByVendorIsolated(
  result: IStatsByVendor | IStatsByVendorIsolated,
): result is IStatsByVendorIsolated {
  return 'latency' in result;
}

export type IStatsByVendorExtendedMixed = IStatsByVendor & { queryName: string; category: QueryCategory };
export type IStatsByVendorExtendedIsolated = IStatsByVendorIsolated & { queryName: string; category: QueryCategory };
export type IStatsByVendorExtendedRealistic = IStatsByVendor & { queryName: string };

export function isStatsByVendorExtendedIsolated(
  result: IStatsByVendorExtendedMixed | IStatsByVendorExtendedIsolated | IStatsByVendorExtendedRealistic,
): result is IStatsByVendorExtendedIsolated {
  return 'latency' in result && 'category' in result;
}

export function isStatsByVendorExtendedMixed(
  result: IStatsByVendorExtendedMixed | IStatsByVendorExtendedIsolated | IStatsByVendorExtendedRealistic,
): result is IStatsByVendorExtendedMixed {
  return !('latency' in result) && 'category' in result;
}

export function isStatsByVendorExtendedRealistic(
  result: IStatsByVendorExtendedMixed | IStatsByVendorExtendedIsolated | IStatsByVendorExtendedRealistic,
): result is IStatsByVendorExtendedRealistic {
  return !('latency' in result) && !('category' in result);
}

export interface IQuery {
  queryName: string;
  statsByVendor: (IStatsByVendor | IStatsByVendorIsolated)[];
}

export interface IQueriesByCategory {
  category?: QueryCategory;
  queries: IQuery[];
}

export const PERCENTAGES_NAME_BY_KEY: Record<keyof IPercentages, string> = {
  analyticalPerc: 'Analytical',
  queryPerc: 'Query',
  updatePerc: 'Update',
  readPerc: 'Read',
  writePerc: 'Write',
  numOfQueries: 'Number of Queries',
};

export const TOOLTIP_OF_CONDITION: Record<RunConfigCondition, string> = {
  [RunConfigCondition.COLD]: 'The system has no pre-warmed caches before the test execution',
  [RunConfigCondition.HOT]: 'The system has pre-warmed caches before the test execution',
  [RunConfigCondition.VULCANIC]: 'The system has executed an identical workload before the measurement.',
};

export const TOOLTIP_OF_PLATFORM: Record<Platform, string> = {
  [Platform.AMD]: 'r7a.4xlarge',
  [Platform.INTEL]: 'r7i.4xlarge',
};

export const TOOLTIP_OF_DATASET_SIZE: Record<DatasetSize, string> = {
  [DatasetSize.SMALL]: '10k vertices, 121k edges',
  [DatasetSize.MEDIUM]: '100k vertices, 1.76M edges',
  [DatasetSize.LARGE]: '1.63M vertices, 30M edges',
  [DatasetSize.SF_01]: '320k vertices, 1.5M edges',
  [DatasetSize.SF_1]: '3M vertices, 1.7M edges',
};

export const TOOLTIP_OF_WORKLOAD_TYPE: Record<WorkloadType, string> = {
  [WorkloadType.ISOLATED]: 'Concurrent execution of a single isolated query',
  [WorkloadType.MIXED]: 'Concurrent execution of single query with a defined percentage of write queries',
  [WorkloadType.REALISTIC]: 'Concurrent execution of different queries',
};

export const TOOLTIP_OF_RESULT_TYPE: Record<ResultType, string> = {
  [ResultType.LATENCY]: 'Isolated single thread query latency, p99',
  [ResultType.MEMORY]: 'Peak process memory during database run',
  [ResultType.THROUGHPUT]: 'Queries per second accross concurrent threads',
};

@Component({
  selector: 'app-overview',
  templateUrl: './overview.component.html',
  styleUrls: ['./overview.component.scss'],
})
export class OverviewComponent implements AfterContentInit {
  currentTab_ = new BehaviorSubject<ITab>(ITab.AGGREGATE);
  currentTab$ = this.currentTab_.asObservable();

  onScroll_ = new BehaviorSubject<Event | undefined>(undefined);
  onScroll$ = this.onScroll_.asObservable();

  shouldShowBanner_ = new BehaviorSubject<boolean>(true);
  shouldShowBanner$ = combineLatest([this.shouldShowBanner_.asObservable(), this.currentTab$]).pipe(
    map(([shouldShow, currentTab]) => shouldShow && currentTab !== ITab.AGGREGATE),
  );

  tutorialLink = TUTORIAL_LINK;

  tabs = [ITab.AGGREGATE, ITab.GLOBAL, ITab.DETAILED];

  settings$ = this.store.select(BenchmarkSelectors.selectSettings);

  activatedConditions$ = this.settings$.pipe(
    map((settings) =>
      settings?.conditions.filter((condition) => condition.isActivated).map((condition) => condition.name),
    ),
  );

  activatedPlatforms$ = this.settings$.pipe(
    map((settings) => settings?.platforms.filter((platform) => platform.isActivated).map((platform) => platform.name)),
  );

  activatedVendors$ = this.settings$.pipe(
    map((settings) => settings?.vendors.filter((vendor) => vendor.isActivated).map((vendor) => vendor.name)),
  );

  activatedNumberOfWorkers$ = this.settings$.pipe(
    map((settings) => settings?.numberOfWorkers.filter((worker) => worker.isActivated).map((worker) => worker.size)),
  );

  activatedDatasetNames$ = this.settings$.pipe(
    map((settings) => settings?.datasetNames.filter((name) => name.isActivated).map((name) => name.name)),
  );

  activatedDatasetSizes$ = this.settings$.pipe(
    map((settings) => settings?.datasetSizes.filter((size) => size.isActivated).map((size) => size.name)),
  );

  activatedWorkloadTypes$ = this.settings$.pipe(
    map((settings) => settings?.workloadTypes.filter((type) => type.isActivated).map((type) => type.name)),
  );

  activatedQueryCategories$ = this.settings$.pipe(
    map((settings) =>
      settings?.queryCategories.filter((category) => {
        if (category.isActivated) {
          const filteredQueries = category.queries.filter((query) => query.isActivated);
          return {
            ...category,
            queries: filteredQueries,
          };
        }
        return false;
      }),
    ),
  );

  presentedBenchmarks$: Observable<IBenchmark[] | undefined> = combineLatest([
    this.store.select(BenchmarkSelectors.selectBenchmarks),
    this.activatedConditions$,
    this.activatedVendors$,
    this.activatedNumberOfWorkers$,
    this.activatedDatasetNames$,
    this.activatedDatasetSizes$,
    this.activatedQueryCategories$,
    this.activatedWorkloadTypes$,
    this.activatedPlatforms$,
  ]).pipe(
    map(
      ([
        benchmarks,
        activatedConditions,
        activatedVendors,
        activatedNumberOfWorkers,
        activatedDatasetNames,
        activatedSizes,
        activatedQueryCategories,
        activatedWorkloadTypes,
        activatedPlatforms,
      ]) =>
        benchmarks
          ?.filter(
            (benchmark) =>
              activatedConditions?.includes(benchmark.runConfig.condition) &&
              activatedVendors?.includes(benchmark.runConfig.vendor) &&
              activatedPlatforms?.includes(benchmark.runConfig.platform) &&
              activatedNumberOfWorkers?.includes(benchmark.runConfig.numberWorkers),
          )
          .map((benchmark) => {
            const filteredDatasets = benchmark.datasets.filter(
              (dataset) => activatedSizes?.includes(dataset.size) && activatedDatasetNames?.includes(dataset.name),
            );
            const filteredDatasetByQueries = filteredDatasets.map((dataset) => {
              const filteredWorkloadsByType = dataset.workloads.filter((workload) =>
                activatedWorkloadTypes?.includes(workload.workloadType),
              );
              const filteredWorkloads = filteredWorkloadsByType.map((workload) => {
                if (isWorkloadRealistic(workload)) {
                  return workload;
                }
                const filteredQueries: (IQueryMixed | IQueryIsolated)[] = workload.queries.filter(
                  (query: IQueryMixed | IQueryIsolated) => {
                    const currentCategory = activatedQueryCategories?.find(
                      (category) => category.name === query.category,
                    );
                    if (currentCategory) {
                      const isActivatedQuery = currentCategory.queries.some(
                        (categoryQuery) => categoryQuery.isActivated && categoryQuery.name === query.name,
                      );
                      if (isActivatedQuery) {
                        if (isQueryMixed(query)) {
                          return query;
                        }
                        if (isQueryIsolated(query)) {
                          return query;
                        }
                      }
                    }
                    return false;
                  },
                );
                return mergeWorkload(workload, filteredQueries);
              });
              return { ...dataset, workloads: filteredWorkloads };
            });
            return {
              ...benchmark,
              datasets: filteredDatasetByQueries,
            };
          }),
    ),
  );

  detailedQueries$ = this.presentedBenchmarks$.pipe(
    filterNullish(),
    map((benchmarks) => {
      const allResultsByVendor: (
        | IStatsByVendorExtendedMixed
        | IStatsByVendorExtendedRealistic
        | IStatsByVendorExtendedIsolated
      )[] = benchmarks
        ?.map((benchmark) =>
          benchmark.datasets.map((datasets) =>
            datasets.workloads.map((workload) => {
              if (isWorkloadRealistic(workload)) {
                return {
                  vendor: benchmark.runConfig.vendor,
                  memory: { value: workload.stats.database.memory, isWeakest: true, relativeValue: 1 },
                  throughput: { value: workload.stats.throughput, isWeakest: true, relativeValue: 1 },
                  queryName: JSON.stringify(workload.percentages),
                  percentages: workload.percentages,
                };
              }
              if (isWorkloadIsolated(workload)) {
                return workload.queries.map((query) => ({
                  vendor: benchmark.runConfig.vendor,
                  memory: { value: query.stats.database.memory, isWeakest: true, relativeValue: 1 },
                  throughput: { value: query.stats.throughput, isWeakest: true, relativeValue: 1 },
                  latency: {
                    value: query.stats.queryStatistics[LATENCY_PERCENTILE] * 1000,
                    isWeakest: true,
                    relativeValue: 1,
                  },
                  queryName: query.name,
                  category: query.category,
                }));
              }
              return workload.queries.map((query) => ({
                vendor: benchmark.runConfig.vendor,
                memory: { value: query.stats.database.memory, isWeakest: true, relativeValue: 1 },
                throughput: { value: query.stats.throughput, isWeakest: true, relativeValue: 1 },
                queryName: query.name,
                category: query.category,
                percentages: workload.percentages,
              }));
            }),
          ),
        )
        .flat(3);
      const groupedByName = _.groupBy(allResultsByVendor, 'queryName');
      const groupedByNamesObject = Object.values(groupedByName);
      const groupedByNamesToType = groupedByNamesObject.map((results) => {
        const weakestMemory = results.reduce((a, b) =>
          a.memory.value > b.memory.value && b.memory.value !== 0 ? a : b,
        );
        const weakestThroughput = results.reduce((a, b) => (a.throughput.value < b.throughput.value ? a : b));
        const weakestLatency = results.reduce((a, b) => {
          if (isStatsByVendorExtendedIsolated(a) && isStatsByVendorExtendedIsolated(b)) {
            return (a as IStatsByVendorIsolated).latency.value > (b as IStatsByVendorIsolated).latency.value &&
              (b as IStatsByVendorIsolated).latency.value !== 0
              ? a
              : b;
          }
          return a;
        });
        const statsByVendorWithRelativeValues = results.map((result) => {
          let percentages: IPercentages | undefined;
          if (!isStatsByVendorExtendedIsolated(result)) {
            percentages = result.percentages;
          }
          let returnValue: IStatsByVendor | IStatsByVendorIsolated = {
            vendor: result.vendor,
            memory: {
              value: result.memory.value,
              isWeakest: weakestMemory.vendor === result.vendor,
              relativeValue:
                weakestMemory.vendor === result.vendor
                  ? 1
                  : weakestMemory.memory.value !== 0
                  ? weakestMemory.memory.value / result.memory.value
                  : Infinity,
            },
            throughput: {
              value: result.throughput.value,
              isWeakest: weakestThroughput.vendor === result.vendor,
              relativeValue:
                weakestThroughput.vendor === result.vendor
                  ? 1
                  : weakestThroughput.throughput.value !== 0
                  ? result.throughput.value / weakestThroughput.throughput.value
                  : Infinity,
            },
            percentages,
          };
          if (isStatsByVendorExtendedIsolated(result)) {
            const latency = {
              value: result.latency.value,
              isWeakest: weakestLatency.vendor === result.vendor,
              relativeValue:
                weakestLatency.vendor === result.vendor
                  ? 1
                  : (weakestLatency as IStatsByVendorIsolated).latency.value !== 0
                  ? (weakestLatency as IStatsByVendorIsolated).latency.value / result.latency.value
                  : Infinity,
            };
            returnValue = { ...returnValue, latency };
          }
          return returnValue;
        });
        let category: QueryCategory | undefined;
        if (isStatsByVendorExtendedIsolated(results[0]) || isStatsByVendorExtendedMixed(results[0])) {
          category = results[0].category;
        }
        return {
          queryName: results[0].queryName,
          category: category,
          statsByVendor: statsByVendorWithRelativeValues,
        };
      });
      const groupedByCategory = _.groupBy(groupedByNamesToType, 'category');
      const groupedByCategoryObject = Object.values(groupedByCategory);
      const detailedQueries: IQueriesByCategory[] = groupedByCategoryObject.map((object) => ({
        category: object[0].category,
        queries: object.map((stats) => ({
          queryName: stats.queryName,
          statsByVendor: stats.statsByVendor,
        })),
      }));
      return detailedQueries;
    }),
  );

  ITab = ITab;
  constructor(
    private readonly store: Store<AppState>,
    private router: Router,
    private route: ActivatedRoute,
    private segmentService: SegmentService,
  ) {}

  ngAfterContentInit(): void {
    const tabFromParams = this.route.snapshot.queryParamMap.get('tab') as ITab | null;
    if (tabFromParams) {
      this.currentTab_.next(tabFromParams);
    }
  }

  changeCurrentTab(newTab: ITab) {
    const queryParams: Params = {
      tab: newTab,
    };
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: queryParams,
      queryParamsHandling: 'merge',
    });
    this.currentTab_.next(newTab);
  }

  onScroll(event: Event) {
    this.onScroll_.next(event);
  }

  openLink(url: string) {
    this.segmentService.trackEvent('Link Clicked', { linkUrl: url });
  }
}

const mergeWorkload = (
  workload: IWorkloadIsolated | IWorkloadMixed,
  queries: (IQueryMixed | IQueryIsolated)[],
): IWorkload => {
  const mergedWorkload: IWorkloadIsolated | IWorkloadMixed = {
    ...workload,
    queries: [],
  };

  if (isWorkloadIsolated(mergedWorkload)) {
    queries.forEach((query) => {
      if (isQueryIsolated(query)) {
        mergedWorkload.queries.push(query);
      }
    });
  }

  if (isWorkloadMixed(mergedWorkload)) {
    queries.forEach((query) => {
      if (isQueryMixed(query)) {
        mergedWorkload.queries.push(query);
      }
    });
  }

  return mergedWorkload;
};

export const generateNameByPercentages = (percentages: IPercentages, delimiter = '+'): string => {
  let generatedName = '';
  if (percentages.analyticalPerc > 0) {
    generatedName += ` ${delimiter} ${percentages.analyticalPerc}% Analytical`;
  }
  if (percentages.readPerc > 0) {
    generatedName += ` ${delimiter} ${percentages.readPerc}% Read`;
  }
  if (percentages.updatePerc > 0) {
    generatedName += ` ${delimiter} ${percentages.updatePerc}% Update`;
  }
  if (percentages.writePerc > 0) {
    generatedName += ` ${delimiter} ${percentages.writePerc}% Write`;
  }
  return generatedName;
};

export const getBackgroundColor = (relativeValue: number): string => {
  if (relativeValue < 5) {
    return '#EDF9F3';
  }
  if (relativeValue < 10) {
    return '#DAF2E6';
  }
  if (relativeValue < 20) {
    return '#CBF0DE';
  }
  if (relativeValue < 50) {
    return '#B5E5CE';
  }
  if (relativeValue < 80) {
    return '#9FDFC0';
  }
  return '#6DCA9E';
};
