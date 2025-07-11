import { Component, EventEmitter, Input, Output, OnInit } from '@angular/core';
import { StepDirective } from '../step.directive';
import { MweState, StepType } from '../../../pages/multi-step-page/steps';
import { MweCanonicalForm, NotificationService, StateService } from '../../../services/_index';
import { BehaviorSubject, combineLatestWith, map, Subscription } from 'rxjs';

const STEP: number = 20;

@Component({
    selector: 'grt-sentence-collection',
    templateUrl: './sentence-collection.component.html',
    styleUrls: ['./sentence-collection.component.scss']
})
export class SentenceCollectionComponent extends StepDirective<MweState> implements OnInit {
    public stepType = StepType.CanonicalFormInput;

    private limit: number;
    private filterString$ = new BehaviorSubject<string>('');
    private sentences$ = new BehaviorSubject<MweCanonicalForm[]>([]);
    private subscription: Subscription;

    filterString: string = '';
    warning = false;

    private filteredSentences: MweCanonicalForm[] = [];
    visibleSentences: MweCanonicalForm[] = [];

    @Input()
    set sentences(value: MweCanonicalForm[]) {
        this.sentences$.next(value);
    }

    @Input()
    title: string;

    @Output()
    onChange = new EventEmitter<{
        /** text expression */
        text: string,
        /** chosen id (if any) */
        id?: number,
        /** if we should not yet go to the next step */
        stay?: boolean
    }>();

    constructor(stateService: StateService<MweState>, notificationService: NotificationService) {
        super(stateService, notificationService);

        this.subscription = new Subscription();
        this.subscription.add(
            stateService.state$.subscribe(state => {
                this.filterString$.next(state.canonicalForm.text);
            }));
        this.subscription.add(
            this.filteredSentences$.subscribe(filteredSentences => {
                this.count = filteredSentences.length;
                this.filteredSentences = filteredSentences;
                this.visibleSentences = this.filteredSentences.slice(0, this.limit);
            })
        );

        this.limit = STEP;
    }

    getWarningMessage(): string | void {
        this.warning = true;
        return 'Expression cannot be empty';
    }

    filterStringChanged(event: Event) {
        const text = (event.target as HTMLInputElement)?.value ?? '';
        if (text.trim().length) {
            // reset any warning
            this.warning = false;
        }
        this.onChange.emit({ text, stay: true });
    }

    filteredSentences$ = this.filterString$.pipe(
        combineLatestWith(this.sentences$),
        map(([filterString, sentences]) => {
            this.filterString = filterString ?? '';
            if (!filterString) {
                // start with all sentences
                return sentences;
            }
            return sentences.filter((sent) => {
                const words = this.filterString.split(/\s+/);
                let match = true;
                words.forEach((word) => {
                    match &&= (sent.text.indexOf(word) >= 0);
                });
                return match;
            });
        }));

    ngOnInit(): void {
        super.ngOnInit();
    }

    ngOnDestroy(): void {
        super.ngOnDestroy();
        this.subscription.unsubscribe();
    }

    count: number;

    visible(): number {
        return Math.min(this.count, this.limit);
    }

    showMore(): void {
        this.limit += STEP;
        this.visibleSentences = this.filteredSentences.slice(0, this.limit);
    }

    submit() {
        const filtered = this.visibleSentences;
        if (filtered.length === 1) {
            // only one match left, search for it!
            this.onChange.emit(filtered[0]);
        } else {
            this.onChange.emit({ text: this.filterString });
        }
    }
}
