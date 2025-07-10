import { Component, Input, EventEmitter, Output, OnInit, OnDestroy } from '@angular/core';
import { faExpand } from '@fortawesome/free-solid-svg-icons';
import { StepDirective } from '../step.directive';
import { NotificationService, StateService } from '../../../services/_index';
import { GlobalStateExampleBased, StepType } from '../../../pages/multi-step-page/steps';
import { TreeVisualizerDisplay } from '../../tree-visualizer/tree-visualizer.component';

@Component({
    selector: 'grt-parse',
    templateUrl: './parse.component.html',
    styleUrls: ['./parse.component.scss']
})
export class ParseComponent extends StepDirective<GlobalStateExampleBased> implements OnInit, OnDestroy {
    faExpand = faExpand;

    @Input() public loading = true;
    @Input() public sentence: string;
    @Input() public xml: string;
    @Output() public changeXml = new EventEmitter<string>();

    public display: TreeVisualizerDisplay = 'inline';
    public stepType = StepType.Parse;
    public warning?: string;

    constructor(stateService: StateService<GlobalStateExampleBased>, notificationService: NotificationService) {
        super(stateService, notificationService);
    }

    public getWarningMessage(): string | void {
        this.warning = `Error parsing sentence: ${this.sentence}`; // we display our own error
    }

    ngOnInit() {
        super.ngOnInit();
    }

    ngOnDestroy() {
        super.ngOnDestroy();
    }
}
