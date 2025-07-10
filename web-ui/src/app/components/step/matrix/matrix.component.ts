import { Component, EventEmitter, Output, OnInit, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { ConfirmationService } from 'primeng/api';
import { faCircleInfo, faEdit, faExpand, faTimes } from '@fortawesome/free-solid-svg-icons';

import { ValueEvent } from 'lassy-xpath';

import { StateService } from '../../../services/_index';
import { StepDirective } from '../step.directive';
import { StepType, GlobalStateExampleBased } from '../../../pages/multi-step-page/steps';
import { NotificationService } from '../../../services/notification.service';
import { animations } from '../../../animations';
import { matrixOptions, Matrix, TokenAttributes, TokenDependents, MatrixOptionKey } from '../../../models/matrix';
import { TreeVisualizerDisplay } from '../../tree-visualizer/tree-visualizer.component';

interface IndexedToken {
    /**
     * string value of this token
     */
    value: string,
    index: number
}

@Component({
    animations,
    selector: 'grt-matrix',
    templateUrl: './matrix.component.html',
    styleUrls: ['./matrix.component.scss']
})
export class MatrixComponent extends StepDirective<GlobalStateExampleBased> implements OnInit, OnDestroy {
    faCircleInfo = faCircleInfo;
    faEdit = faEdit;
    faExpand = faExpand;
    faTimes = faTimes;

    private warningId: number;
    private subscriptions: Subscription[];
    private matrix: Matrix;

    public stepType = StepType.Matrix;

    public attributes: TokenAttributes[];
    public tokenDependents: TokenDependents[];

    public set tokens(values: string[]) {
        if (this.indexedTokens &&
            values.length === this.indexedTokens.length) {
            // only update the values, but prevent the whole array
            // from being re-rendered
            for (let i = 0; i < values.length; i++) {
                this.indexedTokens[i].value = values[i];
            }
        } else {
            this.indexedTokens = values.map((value, index) => ({ value, index }));
        }
        this.filename = values.filter(t => t.match(/[^'"-:!?,\.]/)).join('-').toLowerCase() + '.xml';
    }

    public get tokens() {
        return this.indexedTokens.map(t => t.value);
    }

    public loading: boolean;
    public subTreeXml: string;
    public xpath: string;
    public isCustomXPath: boolean;
    public respectOrder: boolean;
    public retrieveContext: boolean;
    public ignoreTopNode: boolean;

    @Output()
    public changeValue = new EventEmitter<MatrixSettings>();

    public filename: string;
    public subTreeDisplay: TreeVisualizerDisplay = 'inline';

    public indexedTokens: IndexedToken[];
    public showAdvanced: boolean;
    /**
     * If an advanced option has been selected, the toggle will be disabled.
     */
    public alwaysAdvanced: boolean;

    public options = matrixOptions;
    public explanation: string = undefined;

    private originalXPath: string;

    constructor(stateService: StateService<GlobalStateExampleBased>,
        private confirmationService: ConfirmationService,
        notificationService: NotificationService) {
        super(stateService, notificationService);
        this.subscriptions = [
            this.state$.subscribe(state => {
                this.ignoreTopNode = state.ignoreTopNode;
                this.isCustomXPath = state.isCustomXPath;
                this.respectOrder = state.respectOrder;
                this.retrieveContext = state.retrieveContext;
                this.subTreeXml = state.subTreeXml;
                this.tokens = state.tokens;
                this.xpath = state.xpath;
                this.loading = state.loading;

                let first = false;
                if (this.matrix === undefined) {
                    this.matrix = Matrix.default(state.tokens.length);
                    // make sure a new matrix is initialized
                    first = true;
                }
                if (this.matrix.setMultiple(state.attributes) || first) {
                    this.updateMatrix();
                }
            })
        ];
    }

    public setTokenRow<T extends MatrixOptionKey>(key: T) {
        if (this.isCustomXPath) {
            this.warningId = this.notificationService.add('It is not possible to use the matrix when using custom xpath.');
            return;
        }

        this.matrix.rotateRow(key);
        this.updateMatrix();

        this.emitChange();
    }

    public setTokenPart(token: IndexedToken, key: MatrixOptionKey) {
        if (this.isCustomXPath) {
            this.warningId = this.notificationService.add('It is not possible to use the matrix when using custom xpath.');
            return;
        }

        this.matrix.rotate(token.index, key);
        this.updateMatrix();

        this.emitChange();
    }

    private updateMatrix() {
        this.attributes = this.matrix.attributes;
        let { advanced, dependents } = this.matrix.info();
        this.alwaysAdvanced = advanced;
        this.tokenDependents = dependents;
        if (advanced) {
            // this might happen when the page is reloaded
            this.showAdvanced = true;
        }
        // hello change detection
        this.indexedTokens = [...this.indexedTokens];
    }

    private emitChange(settings: Partial<MatrixSettings> = {}) {
        if (settings.customXPath == null) {
            this.valid = true;
        }
        this.changeValue.next(Object.assign({
            attributes: [...this.matrix.attributes],
            retrieveContext: this.retrieveContext,
            customXPath: settings.customXPath || null,
            respectOrder: this.respectOrder,
            tokens: [...this.tokens],
            ignoreTopNode: this.ignoreTopNode
        }, settings));
        this.updateValidity();
    }

    public toggleSetting(key: 'retrieveContext' | 'respectOrder' | 'ignoreTopNode') {
        this.emitChange({ [key]: !this[key] });
    }

    public changeCustomXpath(valueEvent: ValueEvent) {
        this.valid = !valueEvent.error && !!valueEvent.xpath;
        if (!!valueEvent.xpath) {
            this.emitChange({ customXPath: valueEvent.xpath });
        }
    }

    public editXPath() {
        this.originalXPath = this.xpath;
        this.emitChange({ customXPath: this.xpath });
    }

    public resetXPath() {
        const reset = () => {
            this.valid = true;
            this.emitChange();
            this.notificationService.cancel(this.warningId);
        };
        if (this.xpath === this.originalXPath) {
            reset();
        } else {
            this.confirmationService.confirm({
                message: 'Are you sure you want to reset your custom XPath query?',
                accept: reset
            });
        }
    }

    private updateValidity() {
        this.changeValid.emit(this.valid);
    }

    public getWarningMessage() {
        return 'Please make sure the xpath query is correct.';
    }

    ngOnInit() {
        super.ngOnInit();
    }

    ngOnDestroy() {
        this.notificationService.cancel(this.warningId);
        this.subscriptions.forEach(s => s.unsubscribe());
        super.ngOnDestroy();
    }
}

export interface MatrixSettings {
    attributes: TokenAttributes[];
    customXPath: string;
    retrieveContext: boolean;
    respectOrder: boolean;
    tokens: string[];
    ignoreTopNode: boolean;
}
