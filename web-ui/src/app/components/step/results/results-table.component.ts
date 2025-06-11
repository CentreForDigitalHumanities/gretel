import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, NgZone } from '@angular/core';
import { faBars, faChevronLeft, faChevronRight, faCommentDots, faCommentSlash, faFileAlt, faHighlighter, faPrint } from '@fortawesome/free-solid-svg-icons';
import { Subscription, Observable, combineLatest } from 'rxjs';
import {
    debounceTime,
    distinctUntilChanged,
    mergeMap,
    map,
    switchMap
} from 'rxjs/operators';
import { animations } from '../../../animations';
import { TreebankMetadata, TreebankSelection } from '../../../treebank';
import {
    HitWithOrigin, FilterValues, FilterByXPath,
    StateService,
    MetadataValueCounts,
    ResultsService,
} from '../../../services/_index';
import { GlobalState } from '../../../pages/multi-step-page/steps';
import { Filter } from '../../../models/filter';

const DebounceTime = 200;

@Component({
    animations,
    selector: 'grt-results-table',
    templateUrl: './results-table.component.html',
    styleUrls: ['./results-table.component.scss'],
})
export class ResultsTableComponent implements OnInit, OnDestroy {
    faBars = faBars;
    faChevronLeft = faChevronLeft;
    faChevronRight = faChevronRight;
    faCommentDots = faCommentDots;
    faCommentSlash = faCommentSlash;
    faFileAlt = faFileAlt;
    faHighlighter = faHighlighter;
    faPrint = faPrint;

    @Input()
    public loading = true;

    @Input()
    public loadingDownload = true;

    @Input()
    public filteredResults = [];

    @Input()
    /**
     * Filters on node properties created in the analysis component
     */
    public filterXPaths: FilterByXPath[] = [];

    @Input()
    public retrieveContext: boolean;

    @Output()
    public changeFilterValues = new EventEmitter<FilterValues>();

    @Output()
    public deleteFilter = new EventEmitter<FilterByXPath>();

    @Output()
    public downloadResults = new EventEmitter<boolean>();

    @Output()
    public downloadFilelist = new EventEmitter<void>();

    @Output()
    public prev = new EventEmitter<void>();

    @Output()
    public next = new EventEmitter<void>();

    @Output()
    public showTree = new EventEmitter<HitWithOrigin>();

    @Output()
    public toggleContext = new EventEmitter<void>();

    public activeFilterCount: number;
    @Input()
    public filters: Filter[] = [];
    public filterValues: FilterValues;
    /**
     * Toggle filters column
     */
    public hideFiltersColumn = false;
    public hiddenCount = 0;
    public hasHighlightBackground = false;
    private subscriptions: Subscription[];

    public columns = [
        { field: 'number', header: '#', width: '5%' },
        { field: 'fileId', header: 'ID', width: '20%' },
        { field: 'componentDisplayName', header: 'Component', width: '20%' },
        { field: 'highlightedSentence', header: 'Sentence', width: 'fill' },
    ];

    constructor(
        ngZone: NgZone,
        private resultsService: ResultsService,
        stateService: StateService<GlobalState>) {
        const state$ = stateService.state$;

        const {
            xpath$,
            filterValues$,
            selectedTreebanks$
        } = this.statePipe(state$, 'xpath', 'filterValues', 'selectedTreebanks');

        // the metadata properties for the selected treebanks
        const treebankMetadata$ = this.streamTreebankMetadata(selectedTreebanks$);
        // the values for the properties
        const metadataValueCounts$ = this.streamMetadataValueCounts(xpath$, selectedTreebanks$, filterValues$);

        // subscribed streams
        const filters$ = this.streamFilters(treebankMetadata$, metadataValueCounts$);

        this.subscriptions = [
            filterValues$.subscribe(filterValues => ngZone.run(() => {
                this.filterValues = filterValues;
            })),
            filters$.subscribe(filters => ngZone.run(() => {
                this.filters = filters;
            }))
        ];
    }

    ngOnInit(): void {
    }

    ngOnDestroy() {
        this.subscriptions.forEach(s => s.unsubscribe());
    }


    public filterChange(filterValues: FilterValues) {
        this.changeFilterValues.next(filterValues);
    }

    public print() {
        (window as any).print();
    }

    private statePipe<T extends keyof GlobalState>(
        state$: Observable<GlobalState>,
        ...keys: T[]) {
        type ObservableStateProperties = { [Key in T as `${Key}$`]: Observable<GlobalState[Key]> };
        const result: Partial<ObservableStateProperties> = {};

        for (const key of keys) {
            result[<keyof ObservableStateProperties>`${key}$`] = state$.pipe(
                map(state => state[key]),
                debounceTime(DebounceTime),
                distinctUntilChanged()) as any;
        }

        return result as ObservableStateProperties;

    }

    /** Extracts metadata fields from the selected treebanks */
    private streamTreebankMetadata(selectedTreebanks$: Observable<TreebankSelection>): Observable<TreebankMetadata[]> {
        return selectedTreebanks$.pipe(
            switchMap(selection => Promise.all(selection.corpora.map(corpus => corpus.corpus.treebank))),
            switchMap(treebanks => Promise.all(treebanks.map(t => t.details.metadata()))),
            mergeMap(metadata => metadata));
    }

    private streamMetadataValueCounts(
        xpath$: Observable<string>,
        selectedTreebanks$: Observable<TreebankSelection>,
        filterValues$: Observable<FilterValues>): Observable<MetadataValueCounts> {
        return combineLatest([xpath$, selectedTreebanks$, filterValues$]).pipe(
            switchMap(([xpath, selectedTreebanks, filterValues]) => this.getMetadataValueCounts(xpath, selectedTreebanks, filterValues)));
    }

    /** Retrieves metadata counts based on selected banks and filters */
    private async getMetadataValueCounts(
        xpath: string,
        selectedTreebanks: TreebankSelection,
        filterValues: FilterValues
    ): Promise<MetadataValueCounts> {
        const counts = await Promise.all(selectedTreebanks.corpora.map(({ provider, corpus }) =>
            this.resultsService.metadataCounts(
                xpath,
                provider,
                corpus.name,
                corpus.components,
                Object.values(filterValues)
            ).catch((): MetadataValueCounts => {
                return {};
            }))
        );

        // deep merge all results into a single object
        return this.mergeMetadataValueCounts(counts);
    }

    private mergeMetadataValueCounts(c: MetadataValueCounts[]): MetadataValueCounts {
        return c.reduce<MetadataValueCounts>((counts, cur) => {
            Object.keys(cur)
                .forEach(fieldName => {
                    const field = counts[fieldName] = counts[fieldName] || {};
                    Object.entries(cur[fieldName])
                        .forEach(([metadataValue, valueCount]) => {
                            field[metadataValue] = (field[metadataValue] || 0) + valueCount;
                        });
                });

            return counts;
        }, {});
    }

    /** Transforms metadata fields along with their values into filter definitions */
    private streamFilters(
        metadataFields$: Observable<TreebankMetadata[]>,
        metadataValues$: Observable<MetadataValueCounts>,
    ): Observable<Filter[]> {
        return combineLatest([
            metadataFields$,
            metadataValues$
        ])
            .pipe(
                debounceTime(100), // lots of values bouncing around during initialization
                map(([fields, counts]) => this.getFilters(fields ?? [], counts ?? {}))
            );
    }

    private getFilters(fields: TreebankMetadata[], counts: MetadataValueCounts): Filter[] {
        return fields
            .filter(field => field.show)
            .map<Filter>(item => {
                const options: string[] = [];
                if (item.field in counts) {
                    for (const key of Object.keys(counts[item.field])) {
                        // TODO: show the frequency (the data it right here now!)
                        options.push(key);
                    }
                }

                // use a dropdown instead of checkboxes when there
                // are too many options
                if (item.facet === 'checkbox' && options.length > 8) {
                    item.facet = 'dropdown';
                }

                return <Filter>{
                    field: item.field,
                    dataType: item.type,
                    filterType: item.facet,
                    minValue: item.minValue,
                    maxValue: item.maxValue,
                    options
                };
            });
    }
}
