import { OnDestroy, OnInit, Directive } from '@angular/core';
import { ActivatedRoute, Router, Params } from '@angular/router';

import * as _ from 'lodash';

import { Subscription } from 'rxjs';

import { Crumb } from '../../components/breadcrumb-bar/breadcrumb-bar.component';
import { GlobalState, Step } from './steps';
import { FilterValues, TreebankService, StateService, NotificationService } from '../../services/_index';
import { TreebankSelection } from '../../treebank';

@Directive()
export abstract class MultiStepPageDirective<T extends GlobalState> implements OnDestroy, OnInit {
    public crumbs: Crumb[];
    public globalState: Readonly<T>;
    private warningId: number;
    /**
     * Whether the next step is currently being resolved
     */
    public isTransitioning = false;

    protected abstract defaultGlobalState: T;

    protected steps: Step<T>[];
    protected subscriptions: Subscription[];


    constructor(
        private route: ActivatedRoute,
        private router: Router,
        public treebankService: TreebankService,
        public stateService: StateService<T>,
        protected notificationService: NotificationService) {
    }

    ngOnDestroy() {
        // prevent navigation from deferred events
        this.router = undefined;
        this.subscriptions.forEach(s => s.unsubscribe());
        this.stateService.dispose();
    }

    async ngOnInit() {
        // Template Design Pattern
        const steps = this.initializeSteps();

        this.crumbs = steps.map((step, number) => ({
            name: step.name,
            number
        }));
        this.steps = steps.map(step => step.step);

        const initialState = await this.getInitialState();
        this.stateService.init(initialState, this.steps);
        this.setStateFromParams(this.route.snapshot.queryParams);

        this.subscriptions = [
            this.route.queryParams.subscribe(params => {
                this.setStateFromParams(params);
            }),
            this.stateService.state$.subscribe(state => {
                this.globalState = state;
                if (state.emit) {
                    this.updateUrl(state, state.emit === 'history');
                }
            }),
            this.stateService.isTransitioning$.subscribe(t => this.isTransitioning = t),
            this.stateService.warning$.subscribe(w => {
                if (w === false) {
                    this.notificationService.cancel(this.warningId);
                } else {
                    this.warningId = this.notificationService.add(w, 'error');
                }
            })
        ];
    }

    abstract initializeSteps(): { step: Step<T>, name: string }[];

    /**
     * Returns the properties of the global state which are set in the URL.
     * @param queryParams
     */
    abstract decodeGlobalState(queryParams: { [key: string]: any }): {
        [K in Exclude<keyof T,
            keyof ReturnType<MultiStepPageDirective<T>['decodeGlobalStateCommon']>>]?: T[K] | undefined
    };

    protected decodeGlobalStateCommon(queryParams: { [key: string]: any }) {
        return {
            selectedTreebanks: new TreebankSelection(
                this.treebankService,
                queryParams.selectedTreebanks ? JSON.parse(queryParams.selectedTreebanks) : undefined),
            retrieveContext: this.decodeBool(queryParams.retrieveContext),
            variableProperties: queryParams.varProps ? JSON.parse(queryParams.varProps) : undefined
        };
    }

    encodeGlobalState(state: T): { [key: string]: any } {
        const selectedTreebanks = state.selectedTreebanks.encode();
        return {
            'currentStep': state.currentStep && state.currentStep.number || 0,
            // don't encode the default state
            'xpath': state.xpath !== this.defaultGlobalState.xpath ? state.xpath : undefined,
            'selectedTreebanks': selectedTreebanks && JSON.stringify(selectedTreebanks),
            'retrieveContext': this.encodeBool(state.retrieveContext),
            'varProps': state.variableProperties && state.variableProperties.length ? JSON.stringify(state.variableProperties) : undefined
        };
    }

    private async getInitialState() {
        // Always start at the first step, if it is restored from the query
        // this is done using a jump to make sure all the variables are
        // retrieved again during the state transitions.
        return await this.steps[0].enterStep(Object.assign({}, this.defaultGlobalState));
    }

    private setStateFromParams(params: Params) {
        const decoded = {
            ...this.decodeGlobalStateCommon(params),
            ...this.decodeGlobalState(params)
        };
        this.stateService.setState(_.pickBy(decoded, (item) => item !== undefined) as any, false);
        this.stateService.jump(parseInt(params.currentStep || '0', 10), false);
    }

    /**
     * Go back one step
     */
    async prev() {
        this.stateService.prev();
    }

    /**
     * Goes to the next step if the state is valid. Otherwise a warning will displayed.
     */
    async next() {
        this.stateService.next();
    }

    setValid(valid: boolean): void {
        this.stateService.setState({ valid }, false);
    }

    updateUrl(state: T, writeState = true) {
        const queryParams = this.encodeGlobalState(state);
        this.router.navigate([], {
            relativeTo: this.route,
            queryParams,
            skipLocationChange: false,
            replaceUrl: writeState ? false : true
        });
    }

    goToStep(stepNumber: number) {
        this.stateService.jump(stepNumber);
    }

    updateFilterValues(filterValues: FilterValues) {
        this.stateService.setState({ filterValues }, false);
    }

    filterResults(values: { xpath: string, filterValues: FilterValues }, resultsStep: number) {
        // TODO: xpath
        this.stateService.setState({ filterValues: values.filterValues }, false);
        this.goToStep(resultsStep);
    }

    protected decodeBool(param: string | undefined): boolean | undefined {
        if (param === '1') {
            return true;
        } else if (param === '0') {
            return false;
        }
        return undefined;
    }

    protected encodeBool(bool: boolean) {
        return bool ? '1' : '0';
    }
}
