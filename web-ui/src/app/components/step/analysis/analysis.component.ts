/// <reference path="pivottable.d.ts"/>
/// <reference types="jqueryui"/>
import { Component, Input, OnDestroy, OnInit, NgZone, Output, EventEmitter, HostListener } from '@angular/core';
import { faExpand } from '@fortawesome/free-solid-svg-icons';
import { BehaviorSubject, Subject, Subscription, combineLatest, merge } from 'rxjs';
import { switchMap, first, finalize, debounceTime, map, distinctUntilChanged } from 'rxjs/operators';

import * as $ from 'jquery';
import 'jquery-ui/ui/widgets/draggable';
import 'jquery-ui/ui/widgets/sortable';
import 'pivottable';

import { PathVariable, ReconstructorService } from 'lassy-xpath';

import { animations } from '../../../animations';
import {
    AnalysisService,
    ResultsService,
    Hit,
    FilterValues,
    FilterByXPath,
    FilterValue,
    StateService,
    ParseService,
    NotificationService,
    SearchBehaviour
} from '../../../services/_index';
import { FileExportRenderer } from './file-export-renderer';
import { TreebankMetadata } from '../../../treebank';
import { StepDirective } from '../step.directive';
import { GlobalState, StepType, getSearchVariables } from '../../../pages/multi-step-page/steps';
import { AddNodeEvent } from '../../node-properties/node-properties-editor.component';
import { TreeVisualizerDisplay } from '../../tree-visualizer/tree-visualizer.component';
import { IsMweState } from '../../../pages/multi-word-expressions/multi-word-expressions.component';

const MweAttributes = [
    '#mwe_arguments_heads_fringe',
    '#mwe_arguments_heads_hdword',
    '#mwe_arguments_heads_hdlemma',
    '#mwe_arguments_heads_rel',
    '#mwe_arguments_frame',
    '#mwe_arguments_rel_cats_fringe',
    '#mwe_arguments_rel_cats_poscat',
    '#mwe_arguments_rel_cats_rel',
    '#mwe_components_lemma_parts',
    '#mwe_components_word_parts',
    '#mwe_components_marked_utt',
    '#mwe_determinations_comp_lemma',
    '#mwe_determinations_fringe',
    '#mwe_determinations_head_lemma',
    '#mwe_determinations_head_pos_cat',
    '#mwe_determinations_head_word',
    '#mwe_determinations_node_cat',
    '#mwe_determinations_node_rel',
    '#mwe_modifications_comp_lemma',
    '#mwe_modifications_fringe',
    '#mwe_modifications_head_lemma',
    '#mwe_modifications_head_pos_cat',
    '#mwe_modifications_head_word',
    '#mwe_modifications_node_cat',
    '#mwe_modifications_node_rel',
];

@Component({
    animations,
    selector: 'grt-analysis',
    templateUrl: './analysis.component.html',
    styleUrls: ['./analysis.component.scss']
})
export class AnalysisComponent extends StepDirective<GlobalState> implements OnInit, OnDestroy {
    faExpand = faExpand;

    left: number;
    top: number;
    private $element: JQuery<HTMLElement>;
    private $table: JQuery<HTMLElement> | undefined;
    private $draggable: any | undefined;

    private pivotUiOptions: PivotUiOptions;
    private attributes: string[] = [];
    private metadata: TreebankMetadata[] = [];

    private hitsSubject = new BehaviorSubject<Hit[]>([]);
    private selectedVariablesSubject = new BehaviorSubject<SelectedVariable[]>([]);

    private subscriptions: Subscription[] = [];
    private cancellationToken = new Subject<{}>();

    public custom = false;
    /**
     * Disable changing the analysis when its updating the
     * table.
     */
    public disabled = false;
    public stepType = StepType.Analysis;

    public nodes: { [name: string]: PathVariable; };
    public treeXml: string;
    public treeDisplay: TreeVisualizerDisplay = 'inline';

    public isLoading = true;

    public renderCount = 0;
    public hitsCount = 0;

    public selectedVariable?: SelectedVariable;
    public selectedNodes: { [name: string]: boolean } = {};
    public selectedNodesCount = 0;

    public get canShowMore() {
        return this.renderCount < this.hitsCount && !this.selectedVariable;
    }

    public showMoreSubject = new BehaviorSubject<number>(0);
    public showExplanation = true;

    public nodeAttributes: { value: string, label: string }[];

    @Input()
    public xpath: string;

    @Output()
    public filterResults = new EventEmitter<{
        xpath: string,
        filterValues: FilterValues
    }>();

    @HostListener('document:keydown', ['$event'])
    keyDown(event: KeyboardEvent) {
        switch (event.key) {
            case 'Escape':
                if (this.selectedVariable) {
                    this.cancelVariable();
                }
                break;
        }
    }

    constructor(
        private analysisService: AnalysisService,
        private reconstructorService: ReconstructorService,
        private resultsService: ResultsService,
        private parseService: ParseService,
        notificationService: NotificationService,
        private ngZone: NgZone,
        stateService: StateService<GlobalState>
    ) {
        super(stateService, notificationService);
    }

    ngOnInit() {
        super.ngOnInit();
        this.$element = $('.analysis-component');
        this.initialize();
    }

    ngOnDestroy() {
        super.ngOnDestroy();
        for (const subscription of this.subscriptions) {
            subscription.unsubscribe();
        }
        this.cancellationToken.next({});
    }

    showMore() {
        this.showMoreSubject.next(this.showMoreSubject.value + 1);
    }

    getWarningMessage() {
        // Should never show warning
    }

    nodeClick(nodeName: string) {
        if (nodeName) {
            this.selectedNodes = {
                ...this.selectedNodes,
                [nodeName]: !this.selectedNodes[nodeName]
            };
            this.selectedNodesCount = 0;
            for (let selected of Object.values(this.selectedNodes)) {
                if (selected) {
                    this.selectedNodesCount++;
                }
            }
        }
    }

    deselectNodes() {
        this.selectedNodes = {};
        this.selectedNodesCount = 0;
    }

    private async initialize() {
        // TODO: on change
        const { variables, lookup } = this.parseService.extractVariables(this.xpath);
        this.nodes = lookup;
        this.treeXml = this.reconstructorService.construct(variables, this.xpath);

        const metadata$ = this.state$.pipe(
            map(s => s.selectedTreebanks),
            distinctUntilChanged()).subscribe(async selectedTreebanks => {
                const metadata: TreebankMetadata[][] = await Promise.all(
                    selectedTreebanks.corpora.map(async corpus => (await corpus.corpus.treebank).details.metadata()));
                this.metadata = metadata.filter(x => x !== undefined).flatMap(x => x);
            });

        const results$ = this.state$.pipe(
            debounceTime(100),
            switchMap((state) => {
                const { selectedTreebanks, variableProperties } = state;
                this.isLoading = true;
                this.hitsSubject.next([]);
                let searchBehavior: SearchBehaviour;

                if (IsMweState(state)) {
                    searchBehavior = {
                        expandIndex: true,
                        // TODO: maybe some special behavior needed here?
                        supersetXpath: null,
                        mweQueries: state.querySet.map(query => query.xpath)
                    };
                    this.attributes = MweAttributes;
                } else {
                    this.attributes = [];
                }

                // fetch all results for all selected components/treebanks
                // and merge them into a single stream that's subscribed to.
                const searchResults = merge(...selectedTreebanks.corpora.map(corpus => this.resultsService.getAllResults(
                    this.xpath,
                    corpus.provider,
                    corpus.corpus.name,
                    corpus.corpus.components,
                    false,
                    true,
                    [],
                    getSearchVariables(variables, variableProperties),
                    searchBehavior
                )));

                return searchResults.pipe(finalize(() => {
                    this.isLoading = false;
                }));
            }))
            .subscribe(
                searchResults => {
                    const hits = [...this.hitsSubject.value, ...searchResults.hits];
                    this.hitsCount = hits.length;
                    this.hitsSubject.next(hits);
                },
                error => {
                    NotificationService.addError(error);
                    this.stateService.updateState(state => {
                        // disable the custom properties (it might be the reason for the error)
                        for (const prop of state.variableProperties) {
                            prop.enabled = false;
                            this.custom = true;
                            this.selectedVariable = {
                                attribute: undefined,
                                axis: 'row',
                                nodes: [this.nodes['$node']]
                            };
                        }
                    });
                });

        // wait for the first hits to arrive to actually show a pivot table
        const firstHits$ = this.hitsSubject.pipe(first(hits => hits.length > 0))
            .subscribe(() => {
                this.defaultPivot();
                this.subscriptions.push(this.livePivot());
                firstHits$.unsubscribe();
            });

        this.subscriptions = [
            metadata$,
            results$,
            firstHits$
        ];
    }

    private makeDraggable() {
        if (this.$draggable) {
            this.$draggable.destroy();
        }

        $('.path-variable,.tree-visualizer li[data-varname]').draggable({
            appendTo: 'body',
            connectToSortable: '.pvtHorizList,.pvtRows',
            stop: (event, ui) => {
                if ($('.pvtHorizList').find(ui.helper).length) {
                    this.showVariableToAdd(ui.helper, 'col');
                }
                if ($('.pvtRows').find(ui.helper).length) {
                    this.showVariableToAdd(ui.helper, 'row');
                }
            },
            helper: (event: Event) => {
                let variable: string;
                const selectedNodes = Object.entries(this.selectedNodes)
                    .filter(([_, selected]) => selected)
                    .map(([variable, _]) => variable);

                if (selectedNodes.length) {
                    variable = this.analysisService.joinNodesVariableId(selectedNodes);
                } else {
                    const data = $(event.currentTarget).data();
                    variable = data['variable'] || data['varname'];
                }
                return $(`<li class="tag">${variable}</li>`).css('cursor', 'move');
            },
            revert: true
        });
    }

    public cancelVariable() {
        this.selectedVariable = undefined;
    }

    public async addVariable(customProperty?: AddNodeEvent) {
        const selectedVariable = this.selectedVariable;
        this.selectedVariable = undefined;
        this.deselectNodes();
        const updateSelection = () => {
            this.pivotUiOptions[selectedVariable.axis === 'row' ? 'rows' : 'cols']
                .push(this.analysisService.joinNodesVariableId(selectedVariable.nodes, selectedVariable.attribute));
            this.selectedVariablesSubject.next(this.selectedVariablesSubject.value.concat([selectedVariable]));
        };

        if (customProperty) {
            this.hide();
            selectedVariable.nodes = [this.nodes[customProperty.node.name]];
            selectedVariable.attribute = customProperty.property;

            // we need to have results containing this new property
            const containingHits = this.hitsSubject.pipe(first(hits => hits.length > 0 &&
                customProperty.node.name in hits[0].variableValues &&
                customProperty.property in hits[0].variableValues[customProperty.node.name]))
                .subscribe(() => {
                    if (!containingHits.closed) {
                        containingHits.unsubscribe();
                    }
                    updateSelection();
                }, () => {
                    if (!containingHits.closed) {
                        containingHits.unsubscribe();
                    }
                });

            this.subscriptions.push(containingHits);
        } else {
            updateSelection();
        }
    }

    private defaultPivot() {
        // Show a default pivot using the first node variable's lemma property against the POS property.
        // This way the user will get to see some useable values to help clarify the interface.
        const nodes = Object.values(this.nodes);
        if (nodes.length > 0) {
            const firstNode = nodes[nodes.length > 1 ? 1 : 0];
            this.selectedVariablesSubject.next([{
                attribute: 'pt',
                axis: 'row',
                nodes: [firstNode]
            }, {
                attribute: 'lemma',
                axis: 'col',
                nodes: [firstNode]
            }]);

            const utils = $.pivotUtilities;
            const heatmap = utils.renderers['Heatmap'];
            const renderers = $.extend($.pivotUtilities.renderers,
                { 'File export': (new FileExportRenderer()).render });

            this.pivotUiOptions = {
                aggregators: {
                    'Count': utils.aggregators['Count'],
                    'Count Unique Values': utils.aggregators['Count Unique Values'],
                    'Count as Fraction of Columns': utils.aggregators['Count as Fraction of Columns'],
                    'Count as Fraction of Total': utils.aggregators['Count as Fraction of Total'],
                    'First': utils.aggregators['First'],
                    'Last': utils.aggregators['Last']
                },
                rows: [firstNode.name + '.pt'],
                cols: [firstNode.name + '.lemma'],
                renderer: heatmap,
                renderers,
                onRefresh: (data) => {
                    this.ngZone.run(() => {
                        this.pivotUiOptions = data;
                        if (this.canShowMore) {
                            // table is going to be re-rendered anyway
                            // might as well add the new data
                            this.showMore();
                        } else {
                            this.addTableClickEvent();
                        }
                    });
                }
            };
        } else {
            this.selectedVariablesSubject.next([]);
        }
    }

    private livePivot() {
        return combineLatest(this.selectedVariablesSubject, this.showMoreSubject).subscribe(
            ([selectedVariables, _]) => {
                this.show(selectedVariables, this.hitsSubject.value);
            });
    }

    private showVariableToAdd(helper: JQuery<HTMLElement>, axis: 'row' | 'col') {
        const { nodeNames } = this.analysisService.splitNodesVariableId(helper.text().trim());
        const offset = $('.pvtRendererArea').offset();
        this.top = offset.top;
        this.left = offset.left;

        helper.remove();

        // only work with available attributes
        const attributes = this.analysisService.getNodeAttributes(nodeNames, this.hitsSubject.value);

        this.ngZone.run(() => {
            // show the window to add a new variable for analysis
            this.nodeAttributes = attributes;
            // no need to show that they can drag a node if they just did
            this.showExplanation = false;
            const values = attributes.map(x => x.value);
            this.selectedVariable = {
                attribute: values.find(v => v === 'pt') || values.find(v => v === 'cat') || values[0],
                axis,
                nodes: nodeNames.map(name => this.nodes[name])
            };
        });
    }

    private async show(selectedVariables: SelectedVariable[], hits: Hit[]) {
        try {
            this.pivot(this.attributes, this.metadata.map(m => m.field), hits, selectedVariables);
            this.makeDraggable();
        } catch (error) {
            // TODO: improved error notification
            console.error(error);
        }
    }

    private hide() {
        this.disabled = true;
        this.$table = undefined;
    }

    private pivot(attributeKeys: string[], metadataKeys: string[], hits: Hit[], selectedVariables: SelectedVariable[]) {
        const variables = selectedVariables.reduce((grouped, s) => {
            const name = this.analysisService.joinNodesVariableId(s.nodes);
            if (grouped[name]) {
                grouped[name].push(s.attribute);
            } else {
                grouped[name] = [s.attribute]
            }
            return grouped;
        }, {} as { [variableName: string]: string[] });
        this.renderCount = hits.length;
        const pivotData = this.analysisService.getFlatTable(
            hits,
            variables,
            metadataKeys,
            attributeKeys);
        if (!this.$table) {
            this.disabled = false;
            this.$element.empty();
            this.$table = $('<div>');
            this.$element.append(this.$table);
            this.$table.pivotUI(pivotData, this.pivotUiOptions);
            $('.pvtUi').addClass('table is-bordered');
            return true;
        } else {
            this.$table.pivotUI(pivotData);
            return false;
        }
    }


    private getRowFilters(element: HTMLElement) {
        const rows = this.getRowElements(element);
        return this.getValueFromFilters(rows, this.getRowIndex(element), 'rowSpan');
    }

    private getColumnFilters(element: HTMLElement) {
        const columns = this.getColumnElements(element);
        return this.getValueFromFilters(columns, this.getColumnIndex(element), 'colSpan');
    }

    /**
     * Returns the value of the given filters, based on the given index and the span name from which we must get the span width
     * @param elementGroups
     * @param index
     * @param spanName
     */
    private getValueFromFilters(
        elementGroups: { [name: string]: Element[] },
        index: number,
        spanName: 'colSpan' | 'rowSpan'): FilterValues {
        const results: FilterValues = {};
        for (const id of Object.keys(elementGroups)) {
            const elements = elementGroups[id],
                spans = elements.map(v => ({
                    value: v.innerHTML,
                    size: (v as HTMLTableCellElement)[spanName]
                }));
            let value = '',
                total = 0;
            for (const span of spans) {
                total += span.size;
                if (index < total) {
                    value = span.value;
                    break;
                }
            }
            if (id[0] !== '$') {
                results[id] = this.getFilterValue(id, value);
            }
            else {
                const { nodeNames, attribute } = this.analysisService.splitNodesVariableId(id);
                const values = this.analysisService.splitValues(value);
                for (const i in nodeNames) {
                    const node = nodeNames[i];
                    const subValue = values[i];
                    const subId = `${node}.${attribute}`;
                    results[subId] = this.getFilterForQuery(node, attribute, subValue);
                }
            }
        }
        return results;
    }

    /**
     * Gets filters for an extracted xpath query
     * @param id The variable name representing part of the query and the attribute name
     * @param value The attribute value
     */
    private getFilterForQuery(nodeName: string, attribute: string, value: string): FilterByXPath {
        return this.resultsService.getFilterForQuery(
            nodeName,
            attribute,
            value === AnalysisService.placeholder
                ? null
                : value,
            this.nodes);
    }

    private getFilterValue(field: string, value: string): FilterValue {
        const metadata = this.metadata.find(f => f.field === field);
        switch (metadata.facet) {
            case 'checkbox':
            case 'dropdown':
                return {
                    dataType: 'text',
                    type: 'multiple',
                    values: [value],
                    field
                };
            case 'range':
            case 'slider':
                switch (metadata.type) {
                    case 'date':
                        return {
                            dataType: 'date',
                            type: 'range',
                            min: value,
                            max: value,
                            field,
                        };
                    case 'int':
                        return {
                            dataType: 'int',
                            type: 'range',
                            min: parseInt(value, 10),
                            max: parseInt(value, 10),
                            field,
                        };
                }
        }

        throw `No FilterValue for ${field} ${value}`;
    }


    private getColumnIndex(element: HTMLElement) {
        return this.getNumberFromClass(element, 'col');

    }

    private getRowIndex(element: HTMLElement) {
        return this.getNumberFromClass(element, 'row');
    }

    private getNumberFromClass(element: HTMLElement, className: string): number {
        const name = Array.from(element.classList).filter((cName: string) => cName.includes(className))[0];
        return parseInt(name.replace(className, ''), 10);
    }

    /**
     * Gets the columns by name containing the head elements
     *
     * @param element
     * @returns {string: HTMLElement[]}
     */
    private getColumnElements(element: HTMLElement) {
        const columns: { [name: string]: Element[] } = {},
            topRows = element.parentElement.parentElement.parentElement.childNodes[0],
            // Only use the last row.
            rows = Array.from(topRows.childNodes).slice(0, topRows.childNodes.length - 1);
        for (const child of rows) {
            const newChild = child as HTMLElement, // To make sure there is no compile error
                name = this.getElementByClass(newChild.children, 'pvtAxisLabel')[0].innerHTML,
                children = this.getElementByClass(newChild.children, 'pvtColLabel');
            columns[name] = children;

        }
        return columns;
    }

    private getRowElements(element: HTMLElement) {
        // First get the titles
        const head = element.parentElement.parentElement.parentElement.childNodes[0];
        const body = element.parentElement.parentElement.parentElement.childNodes[1];
        // Only use the last row
        const headRows = Array.from(head.childNodes)[head.childNodes.length - 1];
        const bodyRows = Array.from(body.childNodes).slice(0, body.childNodes.length - 1);
        const titles = Array.from(headRows.childNodes).slice(0, headRows.childNodes.length - 1).map((e: HTMLElement) => e.innerHTML);
        const filters: { [title: string]: Element[] } = {};
        for (const title of titles) {
            filters[title] = [];
        }
        for (const row of bodyRows) {
            const tempRow = row as HTMLTableRowElement,
                childElements = this.getElementByClass(tempRow.children, 'pvtRowLabel');

            let index = titles.length;
            for (let i = childElements.length - 1; i >= 0; i--) {
                const child = childElements[i],
                    title = titles[--index];
                filters[title].push(child);
            }
        }
        return filters;
    }

    private addTableClickEvent() {
        $('.pvtVal').off('click');
        $('.pvtVal').on('click', ($event) => {
            this.ngZone.run(() => {
                const element = $event.currentTarget;
                const filterValues = {
                    ...this.getRowFilters(element),
                    ...this.getColumnFilters(element)
                };

                this.filterResults.next({
                    xpath: this.xpath,
                    filterValues
                });
            });
        });
    }

    private getElementByClass(htmlCollection: HTMLCollection, className: string) {
        const result: Element[] = [];
        for (let i = 0; i < htmlCollection.length; i++) {
            if ($(htmlCollection[i]).hasClass(className)) {
                result.push(htmlCollection[i]);
            }
        }
        return result;
    }
}

interface SelectedVariable {
    attribute: string;
    nodes: PathVariable[];
    axis: 'row' | 'col';
}
