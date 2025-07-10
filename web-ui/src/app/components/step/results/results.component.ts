import { Component, Input, OnDestroy, Output, EventEmitter, OnInit } from '@angular/core';
import { SafeHtml } from '@angular/platform-browser';

import { combineLatest, BehaviorSubject, Subscription, Observable, merge } from 'rxjs';
import {
    debounceTime,
    distinctUntilChanged,
    endWith,
    filter,
    map,
    shareReplay,
    startWith,
    switchMap
} from 'rxjs/operators';

import { ValueEvent } from 'lassy-xpath';

import { animations } from '../../../animations';
import {
    DownloadService,
    FilterByXPath,
    FilterValue,
    FilterValues,
    HitWithOrigin,
    ResultsService,
    ResultsStreamService,
    StateService,
    ParseService,
    NotificationService
} from '../../../services/_index';
import { TreebankSelection } from '../../../treebank';
import { StepDirective } from '../step.directive';
import { NotificationKind } from './notification-kind';
import { GlobalState, StepType, getSearchVariables } from '../../../pages/multi-step-page/steps';
import { Filter } from '../../../models/filter';

const DebounceTime = 200;

interface HiddenComponents {
    [componentId: string]: boolean;
}

interface HideSettings {
    [provider: string]: {
        [corpus: string]: {
            hiddenComponents: HiddenComponents;
        }
    };
}

type HidableHit = HitWithOrigin & { hidden: boolean };

@Component({
    animations,
    selector: 'grt-results',
    templateUrl: './results.component.html',
    styleUrls: ['./results.component.scss']
})
export class ResultsComponent extends StepDirective<GlobalState> implements OnInit, OnDestroy {
    private treebankSelection: TreebankSelection;
    private filterValuesSubject = new BehaviorSubject<FilterValues>({});

    public hidden: HideSettings = {};
    public hiddenCount = 0;
    public filteredResults: HidableHit[] = [];
    public stepType = StepType.Results;

    @Input()
    public xpath: string;

    public validXPath = true;
    public customXPath: string;
    @Output()
    public changeXpath = new EventEmitter<string>();

    @Input('filterValues')
    public set filterValues(v: FilterValues) {
        const values = Object.values(v);
        this.filterValuesSubject.next(v);
        this.filterXPaths = values.filter((val): val is FilterByXPath => val.type === 'xpath');
        this.activeFilterCount = values.length;
    }
    public get filterValues(): FilterValues { return this.filterValuesSubject.value; }

    @Output()
    public changeFilterValues = new EventEmitter<FilterValues>();


    @Input()
    public retrieveContext = false;
    @Output()
    public changeRetrieveContext = new EventEmitter<boolean>();


    @Input()
    public inputSentence: string = null;

    @Output()
    public prev = new EventEmitter();

    @Output()
    public next = new EventEmitter();

    public loading = true;
    public loadingDownload = false;

    public activeFilterCount = 0;
    public filters: Filter[] = [];

    /**
     * Filters on node properties created in the analysis component
     */
    public filterXPaths: FilterByXPath[] = [];

    // Xml tree displaying (of a result)
    public treeXml?: string;
    public treeFilename?: string;
    public loadingTree = false;
    public treeSentence?: SafeHtml;

    public outgoingCounts = {};
    public changes = 0;

    private subscriptions: Subscription[];
    private variableProperties: GlobalState['variableProperties'];

    constructor(private downloadService: DownloadService,
        notificationService: NotificationService,
        private resultsService: ResultsService,
        protected resultsStreamService: ResultsStreamService,
        private parseService: ParseService,
        stateService: StateService<GlobalState>
    ) {
        super(stateService, notificationService);
        this.changeValid = new EventEmitter();
    }

    ngOnInit() {
        super.ngOnInit();
        // intermediate streams
        const state$ = this.state$.pipe(
            shareReplay(1), // this stream is used as input in multiple others, no need to re-run it for every subscription.
        );
        const filterValues$ = this.filterValuesSubject.pipe( // the user-selected values
            debounceTime(1000),
            map(v => Object.values(v)),
            shareReplay(1),
        );

        const results$ = this.createResultsStream(state$, filterValues$);

        this.subscriptions = [
            state$.subscribe(state => {
                this.treebankSelection = state.selectedTreebanks;
                this.variableProperties = state.variableProperties;
                this.xpath = state.xpath;
            }),

            results$.subscribe(r => {
                if (typeof r === 'string') {
                    switch (r) {
                        case 'start': {
                            // info reset on selected treebanks changing (see below).
                            this.loading = true;
                            this.filteredResults = [];
                            this.notificationService.cancelAll();
                            this.hiddenCount = 0;
                            break;
                        }
                        case 'finish': {
                            this.loading = false;
                            break;
                        }
                    }
                } else {
                    switch (r.result.kind) {
                        case NotificationKind.COMPLETE: {
                            // treebank has finished loading
                            break;
                        }
                        case NotificationKind.ERROR: {
                            // treebank has errored out!
                            this.notificationService.add(`Error retrieving results for ${r.corpus.name}: \n${r.result.error.message}`, 'error');
                            break;
                        }
                        case NotificationKind.NEXT: {
                            // some new hits!
                            const [newHits, newHidden] = this.hideHits(r.result.value.hits);
                            this.filteredResults.push(...newHits);
                            this.hiddenCount += newHidden;

                            // Update the counts
                            const corpus = r.corpus.name;
                            const provider = r.provider;
                            if (!this.outgoingCounts.hasOwnProperty(provider)) {
                                this.outgoingCounts[provider] = {};
                            }
                            this.outgoingCounts[provider][corpus] = r.result.value.counts;
                            // trigger change detection
                            this.outgoingCounts = { ...this.outgoingCounts };

                            this.changes = Math.random();

                            break;
                        }
                    }
                }
            }),
        ];
    }

    ngOnDestroy() {
        super.ngOnDestroy();

        for (const subscription of this.subscriptions) {
            subscription.unsubscribe();
        }
    }

    /** Show a tree of the given xml file, needs to contact the server as the result might not contain the entire tree */
    async showTree(result: HitWithOrigin) {
        this.treeXml = undefined;
        this.treeFilename = undefined;
        this.loadingTree = true;
        this.treeSentence = result.highlightedSentence;

        try {
            const treeXml = await this.resultsService.highlightSentenceTree(
                result.provider,
                result.corpus.name,
                result.component,
                result.database,
                result.fileId,
                result.nodeIds,
            );
            this.treeXml = treeXml;
            this.treeFilename = result.fileId.replace(/\.xml$/i, '').replace(/[:\/_\-\\. ]+/g, '_') + '.xml';
        } catch (e) {
            this.treeSentence = undefined;
            this.treeXml = undefined;
            this.loadingTree = false;
            this.notificationService.add('Problem retrieving tree', 'error');
            console.warn(`Error retrieving tree in ${result.provider}:${result.corpus}:${result.component}:${result.fileId}: ${e.error.error}`);
        }

        this.loadingTree = false;
    }

    public deleteFilter(filterValue: FilterValue) {
        const { [filterValue.field]: _, ...updated } = this.filterValues;
        this.filterChange(updated);
    }

    public async downloadResults(includeNodeProperties: boolean) {
        const filterValues = Object.values(this.filterValuesSubject.value);
        const variables = includeNodeProperties
            ? getSearchVariables(
                this.parseService.extractVariables(this.xpath).variables,
                this.variableProperties)
            : undefined;

        this.loadingDownload = true;
        try {
            const results = await Promise.all(
                this.treebankSelection.corpora.map(corpus =>
                    this.resultsService.promiseAllResults(
                        this.xpath,
                        corpus.provider,
                        corpus.corpus.name,
                        corpus.corpus.components,
                        this.retrieveContext,
                        false,
                        filterValues,
                        variables).then(hits => ({
                            corpus: corpus,
                            hits
                        }))));

            const r = results.flatMap(corpusHits => ({
                xpath: this.xpath,
                components: corpusHits.corpus.corpus.components,
                provider: corpusHits.corpus.provider,
                corpus: corpusHits.corpus.corpus.name,
                hits: corpusHits.hits
            }));

            await this.downloadService.downloadResults(r, variables);
        } catch (error) {
            this.notificationService.add('Problem downloading results', 'error');
            console.error(error);
        }
        this.loadingDownload = false;
    }


    public downloadFilelist() {
        const fileNames = this.getFileNames();
        this.downloadService.downloadFilelist(fileNames, 'filelist');
    }

    /**
     * Returns the unique file names from the filtered results sorted on name.
     */
    private getFileNames() {
        return [...new Set(this.filteredResults
            .filter(h => !h.hidden)
            .map(f => f.fileId) // extract names
            .sort())];
    }

    public hideComponents({ provider, corpus, components }: { provider: string, corpus: string, components: string[] }) {
        if (!this.hidden) {
            this.hidden = {};
        }
        if (!this.hidden[provider]) {
            this.hidden[provider] = {};
        }
        const corpusInfo = this.hidden[provider][corpus];
        if (corpusInfo) {
            Object.keys(corpusInfo.hiddenComponents).forEach(comp => {
                corpusInfo.hiddenComponents[comp] = false;
            });
            components.forEach(comp => corpusInfo.hiddenComponents[comp] = true);
        } else {
            this.hidden[provider][corpus] = {
                hiddenComponents: components.reduce((dict, component) => {
                    dict[component] = true;
                    return dict;
                }, {} as HiddenComponents)
            };
        }

        [this.filteredResults, this.hiddenCount] = this.hideHits();
    }

    public filterChange(filterValues: FilterValues) {
        this.changeFilterValues.next(filterValues);
    }

    public addFiltersXPath() {
        this.customXPath = this.resultsService.createFilteredQuery(
            this.xpath || this.customXPath,
            Object.values(this.filterValues));
        this.filterChange({});

        this.changeXpath.next(this.customXPath);
    }

    public changeCustomXpath(valueEvent: ValueEvent) {
        this.validXPath = !valueEvent.error;
        if (this.validXPath) {
            this.customXPath = valueEvent.xpath;
        }
    }

    toggleContext() {
        this.changeRetrieveContext.emit(!this.retrieveContext);
    }

    // ----

    /**
     * Gets up-to-date results for all selected treebanks
     *
     * Three types of values are emitted:
     *  'start': indicates a search/new result set is being started
     *  'finish': all treebanks finished searching
     *  @type {Notification} either a set of results, a finished message, or an error message within a selected treebank
     */
    protected createResultsStream(
        state$: Observable<GlobalState>,
        filterValue$: Observable<FilterValue[]>
    ) {
        return combineLatest(
            [state$, filterValue$]
        ).pipe(
            filter((values) => values.every(value => value != null)),
            map(([state, filterValues]) => ({
                retrieveContext: state.retrieveContext,
                selectedTreebanks: state.selectedTreebanks,
                xpath: state.xpath,
                filterValues
            })),
            distinctUntilChanged((prev, curr) => {
                // results are going to be reloaded, but we need to
                // wait for the debouncing first.
                // already give feedback a change is pending,
                // so the user doesn't think the interface is stuck
                this.loading = true;
                return prev.retrieveContext === curr.retrieveContext &&
                    prev.filterValues === curr.filterValues &&
                    prev.xpath === curr.xpath &&
                    prev.selectedTreebanks.equals(curr.selectedTreebanks);
            }),
            debounceTime(DebounceTime),
            switchMap(({ selectedTreebanks, xpath, filterValues, retrieveContext }) => {
                // create a request for each treebank
                const resultStreams = this.resultsStreamService.stream(
                    xpath,
                    selectedTreebanks,
                    filterValues,
                    retrieveContext);

                // join all results, and wrap the entire sequence in a start and end message so
                // we know what's happening and can update spinners etc.
                return merge(...resultStreams).pipe(
                    startWith('start'),
                    endWith('finish'),
                );
            }),
        );
    }

    /**
     * Mark the hits which are part of hidden components or banks and
     * return a count of the hidden hits.
     */
    private hideHits(hits: HitWithOrigin[] = this.filteredResults): [HidableHit[], number] {
        let count = 0;
        const marked = hits.map(result => {
            const hiddenCorpora = this.hidden && this.hidden[result.provider];
            const component = hiddenCorpora && hiddenCorpora[result.corpus.name];
            const hidden = component && component.hiddenComponents &&
                component.hiddenComponents[result.component];
            if (hidden) {
                count++;
            }
            return Object.assign({}, result, { hidden });
        });

        return [marked, count];
    }

    public getWarningMessage() {
        // Should never show warning
    }
}
