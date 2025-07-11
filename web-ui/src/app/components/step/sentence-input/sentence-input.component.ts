import { Component, EventEmitter, Input, Output, OnInit, OnDestroy } from '@angular/core';
import { StepDirective } from '../step.directive';
import { NotificationService, StateService } from '../../../services/_index';
import { GlobalStateExampleBased, StepType } from '../../../pages/multi-step-page/steps';

@Component({
    selector: 'grt-sentence-input',
    templateUrl: './sentence-input.component.html',
    styleUrls: ['./sentence-input.component.scss']
})
export class SentenceInputComponent extends StepDirective<GlobalStateExampleBased> implements OnInit, OnDestroy {
    public stepType = StepType.SentenceInput;
    public warning = false;

    @Output()
    public changeValue = new EventEmitter<string>();

    @Output()
    public next = new EventEmitter();

    @Input()
    public inputSentence: string = '';

    constructor(stateService: StateService<GlobalStateExampleBased>, notificationService: NotificationService) {
        super(stateService, notificationService);
    }

    public getWarningMessage() {
        this.warning = true;
    }

    inputChanges(event: Event) {
        this.changeValue.emit((event.target as HTMLInputElement).value);
        this.updateValidity((event.target as HTMLInputElement).value);
    }

    ngOnInit() {
        super.ngOnInit();
    }

    ngOnDestroy() {
        super.ngOnDestroy();
    }

    private updateValidity(sentence = this.inputSentence) {
        this.valid = sentence.trim().length !== 0;
        if (this.valid) {
            this.warning = false;
        }
        this.changeValid.emit(this.valid);
    }
}
