import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ResultsComponent } from '../results/results.component';
import { MweQuerySet, MweQuery } from '../../../services/mwe.service';

import {
    debounceTime,
    distinctUntilChanged,
    endWith,
    filter,
    map,
    startWith,
    switchMap
} from 'rxjs/operators';
import { combineLatest, Observable, BehaviorSubject, merge } from 'rxjs';
import {FilterValue} from '../../../services/_index';
import { GlobalState } from '../../../pages/multi-step-page/steps';
import { SearchBehaviour } from '../../../services/results.service';

const DebounceTime = 200;

@Component({
    selector: 'grt-mwe-results',
    templateUrl: './mwe-results.component.html',
    styleUrls: ['./mwe-results.component.scss'],
    providers: [{ provide: ResultsComponent, useClass: MweResultsComponent }],

})
export class MweResultsComponent extends ResultsComponent {
    @Input()
    public canSaveQuery: boolean = true;

    @Input()
    public canonicalForm: string;

    public _currentQuery: MweQuery;
    @Input()
    set currentQuery(value: MweQuery) {
        this._currentQuery = value;
        // when the query is changed we have to clear the exclusion queries,
        // because they probably don't make sense anymore
        this.excludeQuery = {};
        this.emitBehaviour();
    }

    get currentQuery() {
        return this._currentQuery;
    }

    private _querySet: MweQuerySet;
    @Input()
    set querySet(value: MweQuerySet) {
        this._querySet = value;
        this.emitBehaviour();
    }

    get querySet() {
        return this._querySet;
    }

    @Output()
    public changeQuery = new EventEmitter<MweQuery>();

    @Input()
    public retrieveContext = false;
    @Output()
    public changeRetrieveContext = new EventEmitter<boolean>();

    public excludeQuery: { [key: number]: boolean } = {};

    private behaviour$: BehaviorSubject<SearchBehaviour> = new BehaviorSubject({
        supersetXpath: null,
        mweQueries: null,
        expandIndex: true,
    });

    toggleContext() {
        this.changeRetrieveContext.emit(!this.retrieveContext);
    }

    toggleExclude(query: MweQuery, event: Event) {
        this.excludeQuery[query.rank] = !this.excludeQuery[query.rank];
        this.emitBehaviour();
    }

    private emitBehaviour() {
        this.behaviour$.next({
            supersetXpath: this.currentQuery && this.currentQuery.rank != this.supersetQuery?.rank ? this.supersetQuery?.xpath : null,
            expandIndex: true,
            mweQueries: null,
            exclusions: this.querySet?.filter(query => this.excludeQuery[query.rank]).map(query => query.xpath),
        });
    }

    isQueryAdjusted() {
        return this.currentQuery?.id ?? false;
    }

    get supersetQuery() {
        // TODO: avoid constant index
        return this.querySet ? this.querySet[2] : undefined;
    }

    // What follows is mostly a duplicate of ResultsComponent.createResultsStream
    // because it's impossible to override just the part we need to customize (SearchBehaviour)
    // without further refactoring of ResultsComponent, which would be irrelevant for the rest of the app.
    protected createResultsStream(state$: Observable<GlobalState>, filterValue$: Observable<FilterValue[]>) {
        return combineLatest(
            [state$, filterValue$, this.behaviour$]
        ).pipe(
            filter((values) => values.every(value => value != null)),
            map(([state, filterValues, behaviour]) => ({
                selectedTreebanks: state.selectedTreebanks,
                xpath: state.xpath,
                filterValues,
                behaviour
            })),
            distinctUntilChanged((prev, curr) => {
                // results are going to be reloaded, but we need to
                // wait for the debouncing first.
                // already give feedback a change is pending,
                // so the user doesn't think the interface is stuck
                const unchanged = prev.filterValues === curr.filterValues &&
                    prev.xpath === curr.xpath &&
                    prev.selectedTreebanks.equals(curr.selectedTreebanks) &&
                    prev.behaviour === curr.behaviour;
                if (!unchanged) {
                    this.loading = true;
                }
                return unchanged;
            }),
            debounceTime(DebounceTime),
            switchMap(({ selectedTreebanks, xpath, filterValues, behaviour }) => {
                // create a request for each treebank
                const resultStreams = this.resultsStreamService.stream(
                    xpath,
                    selectedTreebanks,
                    filterValues,
                    this.retrieveContext,
                    behaviour
                );

                // join all results, and wrap the entire sequence in a start and end message so
                // we know what's happening and can update spinners etc.
                return merge(...resultStreams).pipe(
                    startWith('start'),
                    endWith('finish'),
                );
            }),
        );
    }
}
