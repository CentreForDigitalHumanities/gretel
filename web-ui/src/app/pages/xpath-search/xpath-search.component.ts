import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { StateService, TreebankService, EmitType, NotificationService } from '../../services/_index';
import { MultiStepPageDirective } from '../multi-step-page/multi-step-page.directive';
import {
    AnalysisStep,
    GlobalState,
    XpathInputStep,
    ResultsStep,
    SelectTreebankStep,
    Step,
} from '../multi-step-page/steps';
import { TreebankSelection } from '../../treebank';

/**
 * The xpath search component is the main component for the xpath search page. It keeps track of global state of the page
 * It uses steps and transitions to determine the next state.
 */
@Component({
    selector: 'grt-xpath-search',
    templateUrl: './xpath-search.component.html',
    styleUrls: ['./xpath-search.component.scss']
})
export class XpathSearchComponent extends MultiStepPageDirective<GlobalState> implements OnInit {
    protected defaultGlobalState: GlobalState = {
        connectionError: false,
        currentStep: undefined,
        filterValues: {},
        retrieveContext: false,
        selectedTreebanks: new TreebankSelection(this.treebankService),
        variableProperties: undefined,
        xpath: `//node[@cat="smain"
    and node[@rel="su" and @pt="vnw"]
    and node[@rel="hd" and @pt="ww"]
    and node[@rel="predc" and @cat="np"
        and node[@rel="det" and @pt="lid"]
        and node[@rel="hd" and @pt="n"]]]`,
        valid: true,
        loading: false
    };

    constructor(treebankService: TreebankService, stateService: StateService<GlobalState>, notificationService: NotificationService, route: ActivatedRoute, router: Router) {
        super(route, router, treebankService, stateService, notificationService);
    }

    initializeSteps(): { step: Step<GlobalState>, name: string }[] {
        return [{
            step: new XpathInputStep(0),
            name: 'XPath'
        }, {
            step: new SelectTreebankStep(1, this.treebankService),
            name: 'Treebanks'
        }, {
            step: new ResultsStep(2),
            name: 'Results'
        }, {
            step: new AnalysisStep(3),
            name: 'Analysis'
        }];
    }

    decodeGlobalState(queryParams: { [key: string]: any }) {
        return {
            selectedTreebanks: new TreebankSelection(
                this.treebankService,
                queryParams.selectedTreebanks ? JSON.parse(queryParams.selectedTreebanks) : undefined),
            xpath: queryParams.xpath || this.defaultGlobalState.xpath
        };
    }

    async updateRetrieveContext(retrieveContext: boolean) {
        this.stateService.setState({
            retrieveContext
        });
    }

    async updateXPath(xpath: string, emit: EmitType) {
        this.stateService.setState({
            xpath
        },
            emit);
    }
}
