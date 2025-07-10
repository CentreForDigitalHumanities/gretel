import { Injectable } from '@angular/core';

import { GlobalState, Step } from '../pages/multi-step-page/steps';
import { StepDirective } from '../components/step/step.directive';
import { BehaviorSubject, filter, firstValueFrom, Observable } from 'rxjs';


/**
 * A transition is used to determine the next step to go to, given the global state and the event that is triggered
 */
class SharedInstance<T extends GlobalState> {
    private steps: Step<T>[];
    private currentStepDirective$ = new BehaviorSubject<StepDirective<T> | false>(false);
    isTransitioning$ = new BehaviorSubject<boolean>(false);
    warning$ = new BehaviorSubject<string | false>(false);
    state$: BehaviorSubject<T & {
        /**
         * Don't emit an updated URL
         */
        emit: EmitType
    }>;

    constructor(state: T, steps: Step<T>[]) {
        this.steps = steps;
        this.state$ = new BehaviorSubject({ ...state, emit: false });
        this.isTransitioning$.next(false);
    }

    subscribe(stepDirective: StepDirective<T>) {
        this.currentStepDirective$.next(stepDirective);
    }

    dispose() {
        this.isTransitioning$.unsubscribe();
        this.warning$.unsubscribe();
    }

    // private currentStepDirect
    /**
     * Go back one step
     */
    async prev(): Promise<T> {
        const state = this.setState({ connectionError: false });
        this.isTransitioning$.next(true);
        this.warning$.next(false);
        return this.jumpState(state, state.currentStep.number - 1);
    }

    /**
     * Goes to the next step if the state is valid. Otherwise a warning will displayed.
     */
    async next(): Promise<T | false> {
        let state = this.state$.value;
        if (state.valid) {
            state = this.setState({ connectionError: false });
            this.isTransitioning$.next(true);
            this.warning$.next(false);
            state = await this.jumpState(state, state.currentStep.number + 1);
            if (state.connectionError) {
                // the initial state may be invalid (e.g. nothing has been selected yet)
                // but if the state is invalid because of a connection error
                // this should be shown to the user!
                this.showWarning(state.currentStep.number);
            }

            return state;
        } else {
            console.warn('Cannot proceed to next step, state is invalid');
            this.showWarning(state.currentStep.number);
            return false;
        }
    }

    async jump(stepNumber: number, emit: EmitType = 'history') {
        this.isTransitioning$.next(true);
        const state = await this.jumpState(this.state$.value, stepNumber, emit);

        if (state.connectionError || (!state.valid && state.currentStep.number !== stepNumber)) {
            this.showWarning(state.currentStep.number);
        } else {
            this.warning$.next(false);
        }

        return state;
    }

    private async currentStepDirectiveAsync() {
        return <StepDirective<T>>await firstValueFrom(this.currentStepDirective$.pipe(filter(d => d !== false)));
    }

    /**
     * Transition the state, creates the new state and marks that a new
     * step component should be rendered.
     * @param state: the current state.
     * @param stepNumber: the index of the step to jump to.
     */
    private async jumpState(state: T, stepNumber: number, emit: EmitType = 'history') {
        const { newState, newComponent } = await this.jumpNewState(state, stepNumber);
        if (newComponent) {
            const currentStepDirective = this.currentStepDirective$.value;
            if (currentStepDirective !== false && newState.currentStep.type !== currentStepDirective.stepType) {
                // the component might have already been rendered
                // which is a bit odd but this can happen during loading
                // (some weird race condition which is resolved by this)
                this.currentStepDirective$.next(false);
            }
        }
        this.isTransitioning$.next(false);
        return this.setState(newState, emit);
    }

    /**
     * Transition the state and creates the new state.
     * @param state: the current state.
     * @param stepNumber: the index of the step to jump to.
     */
    private async jumpNewState(state: T, stepNumber: number) {
        if (!state.currentStep) {
            // no step yet, start at the first one
            state = await this.steps[0].enterStep(state);
        }

        if (state.currentStep.number === stepNumber ||
            stepNumber < 0 ||
            stepNumber > this.steps.length - 1) {
            // no or invalid jump
            return { newState: state, newComponent: false };
        }

        // don't modify the original state
        // (otherwise the interface might display the intermediate state)
        let newState = Object.assign({}, state);

        if (newState.currentStep.number > stepNumber) {
            // jumping backwards is always fine
            newState.currentStep.leaveStep(newState);
            newState.connectionError = false;
            newState.valid = true;
            return { newState: await this.steps[stepNumber].enterStep(newState), newComponent: true };
        }
        let newComponent = false;
        while (newState.currentStep.number < stepNumber && newState.valid) {
            newState.currentStep.leaveStep(newState);
            newState.connectionError = false;
            newState = await this.steps[newState.currentStep.number + 1].enterStep(newState);
            newComponent = true;
        }

        return { newState, newComponent };
    }

    private async showWarning(stepNumber: number) {
        const targetStep = this.steps[stepNumber];
        const currentStep = await this.currentStepDirectiveAsync();
        console.log(currentStep, targetStep);
        if (currentStep.stepType === targetStep.type) {
            this.warning$.next(currentStep.getWarningMessage() || false);
        }
    }

    setState(values: { [K in keyof GlobalState]?: GlobalState[K] }, emit: EmitType = false): T & { emit: EmitType } {
        const nextState = {
            ...this.state$.value,
            ...values,
            emit
        };
        this.state$.next(nextState);
        return nextState;
    }

    updateState(update: (state: T) => void): T {
        const nextState = { ...this.state$.value, emit: 'in-place' as EmitType };
        update(nextState);
        this.state$.next(nextState);
        return nextState;
    }
}

export type EmitType = false | 'in-place' | 'history';

/**
 * For jumps
 */
@Injectable({ providedIn: 'root' })
export class StateService<T extends GlobalState> {
    /**
     * Use a shared instance for the duration of going through the steps
     * (example based or xpath based search). When going to another
     * multi-step page it should be cleared to make sure no deferred
     * actions popup on that page. E.g. a warning message or jump
     * could be fired after a server call is completed.
     */
    private static instance: SharedInstance<any>;
    private get instance() { return StateService.instance; }
    private set instance(value) { StateService.instance = value; }

    state$: Observable<T &
    {
        /**
         * Emit changes to URL and should the browser history be affected?
         */
        emit: EmitType
    }>;
    isTransitioning$: Observable<boolean>;
    warning$: Observable<string | false>;

    /**
     * This is called on entry of the multi-step page
     * @param steps The steps of this page.
     */
    init(initialState: T, steps: Step<T>[]) {
        this.dispose();
        this.instance = new SharedInstance<T>(initialState, steps);
        this.state$ = this.instance.state$.asObservable();
        this.isTransitioning$ = this.instance.isTransitioning$.asObservable();
        this.warning$ = this.instance.warning$.asObservable();
    }

    /**
     * Subscribes a step component once it has been rendered and is ready to
     * receive information e.g. warning messages.
     * @param component The component showing the step state.
     */
    subscribe(component: StepDirective<T>) {
        this.instance.subscribe(component);
    }

    /**
     * Transition that decreases the current step number (if possible)
     */
    prev(): Promise<T> {
        return this.instance.prev();
    }

    /**
     * Transition that increases the current step number (if possible)
     */
    next(): Promise<T> {
        return this.instance.next();
    }

    jump(stepNumber: number, emit: EmitType = 'history'): Promise<T> {
        return this.instance.jump(stepNumber, emit);
    }

    setState(values: Partial<T> | Partial<GlobalState>, emit: EmitType = 'in-place'): T {
        return this.instance.setState(values, emit);
    }

    updateState(update: (state: T) => void): T {
        return this.instance.updateState(update);
    }

    /**
     * Disposes the shared instance when leaving the multi-step page.
     */
    dispose() {
        if (this.instance) {
            this.instance.dispose();
            this.instance = undefined;
        }
    }
}
