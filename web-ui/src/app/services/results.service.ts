import * as $ from 'jquery';
import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

import { Observable } from 'rxjs';

import { ConfigurationService } from './configuration.service';
import { ParseService } from './parse.service';
import { publishReplay, refCount } from 'rxjs/operators';
import { PathVariable, Location } from 'lassy-xpath';
import { NotificationService } from './notification.service';

const httpOptions = {
    headers: new HttpHeaders({
        'Content-Type': 'application/json',
    })
};

export interface VariableProperty {
    name: string;
    expression: string;
    enabled: boolean;
}

export interface SearchVariable {
    name: string;
    path: string;
    props?: VariableProperty[];
}

export interface SearchBehaviour {
    /** if a superset xpath is specified, then the regular xpath query will be run on the results of
        the superset query instead of directly */
    supersetXpath: string,
    expandIndex: boolean,
    /**
     * The queries used to search for MWEs (main, neighbors, superset)
     */
    mweQueries?: string[],

    /** a list of xpath queries whose results should be excluded from the results of the main query */
    exclusions?: string[],
}

@Injectable()
export class ResultsService {
    defaultIsAnalysis = false;
    defaultMetadataFilters: FilterValue[] = [];
    defaultVariables: SearchVariable[] = null;
    defaultBehaviour: SearchBehaviour = { supersetXpath: null, mweQueries: null, expandIndex: false };

    constructor(
        private http: HttpClient,
        private sanitizer: DomSanitizer,
        private configurationService: ConfigurationService,
        private parseService: ParseService,
        private notificationService: NotificationService) {
    }

    /** On error the returned promise rejects with @type {HttpErrorResponse} */
    promiseAllResults(
        xpath: string,
        provider: string,
        corpus: string,
        componentIds: string[],
        retrieveContext: boolean,
        isAnalysis = this.defaultIsAnalysis,
        metadataFilters = this.defaultMetadataFilters,
        variables = this.defaultVariables,
        cancellationToken: Observable<{}> | null = null
    ): Promise<Hit[]> {
        return new Promise<Hit[]>((resolve, reject) => {
            const hits: Hit[] = [];
            const subscription = this.getAllResults(
                xpath,
                provider,
                corpus,
                componentIds,
                retrieveContext,
                isAnalysis,
                metadataFilters,
                variables
            ).subscribe(
                (res: SearchResults) => hits.push(...res.hits),
                (e: HttpErrorResponse) => reject(e),
                () => resolve(hits)
            );

            if (cancellationToken != null) {
                cancellationToken.subscribe(() => {
                    subscription.unsubscribe();
                });
            }
        });
    }

    /** On error the returned stream error has type @type {HttpErrorResponse} */
    getAllResults(
        xpath: string,
        provider: string, // Not used anymore but leave for now
        corpus: string,
        componentIds: string[],
        retrieveContext: boolean,
        isAnalysis = this.defaultIsAnalysis,
        metadataFilters = this.defaultMetadataFilters,
        variables = this.defaultVariables,
        behaviour = this.defaultBehaviour,
    ): Observable<SearchResults> {
        const observable = new Observable<SearchResults>(observer => {
            const worker = async () => {
                let queryId: number = undefined;
                let retrievedMatches: number = 0;

                while (!observer.closed) {
                    let results: SearchResults | false | null = null;
                    let error: HttpErrorResponse | null = null;

                    try {
                        results = await this.results(
                            xpath,
                            corpus,
                            componentIds,
                            queryId,
                            retrievedMatches,
                            retrieveContext,
                            isAnalysis,
                            metadataFilters,
                            variables,
                            behaviour
                        );
                    } catch (e) {
                        error = e;
                    }

                    if (!observer.closed) {
                        if (results) {
                            observer.next(results);
                            queryId = results.queryId;
                            retrievedMatches += results.hits.length;

                            // TODO maybe not the nicest way to show progress
                            const percentage = Math.round(results.searchPercentage)
                            if (!results.cancelled) {
                                this.notificationService.add(
                                    "Searching at " +
                                    percentage + "%", "success"
                                );
                            } else {
                                this.notificationService.add(
                                    "Search was cancelled at " +
                                    percentage + "%", "warning"
                                );
                                observer.complete();
                            }

                            if (results.searchPercentage === 100) {
                                if (results.errors) {
                                    // TODO work on error notifications
                                    this.notificationService.add('Errors occured while searching (check JavaScript console).');
                                    console.log(results.errors);
                                }
                                observer.complete();
                            }
                        } else if (error != null) {
                            observer.error(error);
                        }
                    }
                    await new Promise(r => setTimeout(r, 1000));
                }
            };
            worker();
        });

        return observable.pipe(publishReplay(1), refCount());
    }

    /**
     * Queries the treebank and returns the matching hits.
     * On error the returned promise rejects with @type {HttpErrorResponse}
     *
     * @param xpath Specification of the pattern to match
     * @param corpus Identifier of the corpus
     * @param components Identifiers of the sub-treebanks to search
     * @param queryId The query number, given back by the API after the first request
     * @param retrievedMatches The number of matches previously given by the API so that they are not given again
     * @param retrieveContext Get the sentence before and after the hit
     * @param isAnalysis Whether this search is done for retrieving analysis results, in that case a higher result limit is used
     * @param metadataFilters The filters to apply for the metadata properties
     * @param variables Named variables to query on the matched hit (can be determined using the Extractinator)
     */
    private async results(
        xpath: string,
        corpus: string,
        components: string[],
        queryId: number = undefined,
        retrievedMatches: number = undefined,
        retrieveContext: boolean,
        isAnalysis = this.defaultIsAnalysis,
        metadataFilters = this.defaultMetadataFilters,
        variables = this.defaultVariables,
        behaviour: SearchBehaviour,
    ): Promise<SearchResults | false> {
        const results = await this.http.post<ApiSearchResult | false>(
            await this.configurationService.getDjangoUrl('search/search/'), {
            xpath: this.createFilteredQuery(xpath, metadataFilters),
            retrieveContext,
            treebank: corpus,
            query_id: queryId,
            start_from: retrievedMatches,
            components,
            is_analysis: isAnalysis,
            variables: this.formatVariables(variables),
            behaviour,
        }, httpOptions).toPromise();
        if (results) {
            return this.mapResults(results);
        }

        return false;
    }

    /**
     * Retrieves the full sentence tree and adds a "highlight=yes" attribute to all nodes with ID, and their descendants.
     *
     * On error the returned promise rejects with @type {HttpErrorResponse}
     */
    async highlightSentenceTree(
        provider: string,
        treebank: string,
        component: string,
        database: string,
        sentenceId: string,
        nodeIds: number[],
    ) {
        /* provider, treebank and component are not used anymore,
        but leave them for now */
        const url2 = await this.configurationService.getDjangoUrl(
            'search/tree/'
        );
        const data = {
            database: database,
            sentence_id: sentenceId
        }
        const response = await this.http.post<ApiTreeResult>(
            url2,
            data
        ).toPromise();
        return this.highlightSentenceNodes(response.tree, nodeIds);
    }

    /** adds a "highlight=yes" attribute to all nodes with ID, and their descendants. */
    public highlightSentenceNodes(treeXml: string, nodeIds: Array<string | number>): string {
        const doc = $.parseXML(treeXml);
        const highlightNodes = Array.from(doc.querySelectorAll(nodeIds.map(id => `node[id="${id}"]`).join(',')));
        const highlightDescendants = highlightNodes
            .filter(n => n.hasAttribute('index'))
            .flatMap(n => Array.from(n.querySelectorAll(`node[index="${n.getAttribute('index')}"]`)));

        for (const node of [...highlightNodes, ...highlightDescendants]) {
            node.setAttribute('highlight', 'yes');
        }

        return new XMLSerializer().serializeToString(doc);
    }

    /** On error the returned promise rejects with @type {HttpErrorResponse} */
    async metadataCounts(xpath: string, provider: string, corpus: string, components: string[], metadataFilters: FilterValue[] = []) {
        return await this.http.post<MetadataValueCounts>(
            await this.configurationService.getDjangoUrl('search/metadata-count/'), {
            xpath: this.createFilteredQuery(xpath, metadataFilters),
            treebank: corpus,
            components,
        }, httpOptions).toPromise();
    }

    /** On error the returned promise rejects with @type {HttpErrorResponse} */
    async treebankCounts(xpath: string, provider: string, corpus: string, components: string[], metadataFilters: FilterValue[] = []) {
        const results = await this.http.post<{ [componentId: string]: string }>(
            await this.configurationService.getApiUrl(provider, 'treebank_counts'), {
            xpath: this.createFilteredQuery(xpath, metadataFilters),
            corpus,
            components,
        }, httpOptions).toPromise();

        return Object.keys(results).map(componentId => {
            return {
                componentId: componentId,
                count: parseInt(results[componentId], 10)
            } as TreebankCount;
        });
    }

    /**
     * Modifies an xpath query to query on filters.
     *
     * @param xpath Query to modify
     * @return string The modified xpath
     */
    public createFilteredQuery(xpath: string, filters: FilterValue[]) {
        function escape(value: string | number) {
            return value.toString()
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;');
        }

        const modifiedXpath = (xpath || '').trimRight().split('\n').map(line => ({
            line,
            appends: [] as { position: number, text: string }[]
        }));
        const metadataFilters: string[] = [];
        for (const filter of filters) {
            switch (filter.type) {
                case 'single':
                    // Single values
                    metadataFilters.push(`\tmeta[@name="${escape(filter.field)}" and @value="${escape(filter.value)}"]`);
                    break;
                case 'range':
                    // Ranged values
                    let min: string, max: string, value: string;
                    if (filter.dataType === 'date') {
                        // gets number in the format YYYYMMDD e.g. 19870227
                        min = filter.min.replace(/-/g, '');
                        max = filter.max.replace(/-/g, '');
                        value = `number(translate(@value,'-',''))`;
                    } else {
                        min = escape(filter.min);
                        max = escape(filter.max);
                        value = '@value';
                    }

                    metadataFilters.push(`\tmeta[@name="${escape(filter.field)}" and\n\t\t${value}>=${min} and ${value}<=${max}]`);
                    break;
                case 'multiple':
                    // Single values
                    metadataFilters.push(
                        `\tmeta[@name="${escape(filter.field)}" and
\t\t(${filter.values.map((v) => `@value="${escape(v)}"`).join(' or\n\t\t ')})]`);
                    break;
                case 'xpath':
                    const line = modifiedXpath[filter.location.line - 1];
                    if (line && line.line.substring(filter.location.firstColumn, filter.location.lastColumn) === 'node') {
                        line.appends.push({ position: filter.location.lastColumn, text: filter.attributeXpath });
                    } else {
                        modifiedXpath.push({
                            line: `[${filter.contextXpath}${filter.attributeXpath}]`,
                            appends: []
                        });
                    }
                    break;
            }
        }

        return modifiedXpath.map(line => {
            let offset = 0;
            const lineChars = line.line.split('');
            for (const append of line.appends.sort(a => a.position)) {
                lineChars.splice(append.position + offset, 0, ...append.text.split(''));
                offset += append.text.length;
            }
            return lineChars.join('');
        }).join('\n') + (!metadataFilters.length ? '' : `\n[ancestor::alpino_ds/metadata[\n${metadataFilters.join(' and\n')}]]`)
            .replace(/\t/g, '    ');
    }

    /**
     * Gets filters for an extracted xpath query
     * @param nodeName The variable name of the node.
     * @param attribute The attribute of that node to filter
     * @param value The attribute value (or null for not filtering)
     * @param value The available variables
     */
    public getFilterForQuery(
        nodeName: string,
        attribute: string,
        value: string,
        nodes: { [name: string]: PathVariable }): FilterByXPath {
        const attrSelector = value
            ? `@${attribute}="${value}"`
            : `@${attribute}="" or not(@${attribute})`;
        return {
            field: `${nodeName}.${attribute}`,
            label: `${nodeName}[${attrSelector}]`,
            type: 'xpath',
            location: nodes[nodeName].location,
            contextXpath: this.resolveRootPath(nodes, nodeName),
            attributeXpath: `[${attrSelector}]`
        };
    }

    private resolveRootPath(variables: { [name: string]: PathVariable }, variable: string): string {
        const path = variables[variable].path;
        if (/^\*/.test(path)) {
            return '';
        }

        const match = path.match(/(^\$node\d*)\//);
        if (match) {
            const parentVar = match[1];
            const parentPath = this.resolveRootPath(variables, parentVar);

            return (parentPath ? `${parentPath}/` : '') + path.substring(match[0].length);
        }

        return null;
    }

    private async mapResults(results: ApiSearchResult): Promise<SearchResults> {
        return {
            hits: await this.mapHits(results),
            queryId: results.query_id,
            searchPercentage: results.search_percentage,
            errors: results.errors,
            cancelled: results.cancelled,
            counts: await this.mapCounts(results),
        };
    }

    private mapHits(results: ApiSearchResult): Promise<Hit[]> {
        return Promise.all(results.results.map(async result => {
            const hitId = result.sentid;
            const sentence = result.sentence;
            const previousSentence = result.prevs;
            const nextSentence = result.nexts;
            const nodeStarts = result.begins.split('-').map(x => parseInt(x, 10));
            const metaValues = this.mapMeta(await this.parseService.parseXml(`<metadata>${result.meta}</metadata>`));
            const variableValues = this.mapVariables(await this.parseService.parseXml(result.variables), await this.parseService.parseXml(result.xml_sentences));
            const component = result.component;
            const database = result.database;
            return {
                component,
                database,
                fileId: hitId.replace(/\+match=\d+$/, ''),
                sentence,
                previousSentence,
                nextSentence,
                highlightedSentence: this.highlightSentence(sentence, nodeStarts, 'strong'),
                treeXml: result.xml_sentences,
                nodeIds: result.ids.split('-').map(x => parseInt(x, 10)),
                nodeStarts,
                metaValues,
                attributes: result.attributes,
                /**
                 * Contains the XML of the node matching the variable
                 */
                variableValues
            };
        }));
    }

    private mapCounts(results: ApiSearchResult): Promise<ResultCount[]> {
        return Promise.all(results.counts.map(async count => {
            return {
                component: count.component,
                numberOfResults: count.number_of_results,
                completed: count.completed,
                percentage: count.percentage,
            };
        }));
    }

    private mapMeta(data: {
        metadata: {
            meta?: {
                $: {
                    type: string,
                    name: string,
                    value: string
                }
            }[]
        }[]
    }): Hit['metaValues'] {
        return !data.metadata || !data.metadata.length || !data.metadata[0].meta ? {} : data.metadata[0].meta.reduce((values, meta) => {
            values[meta.$.name] = meta.$.value;
            return values;
        }, {} as Hit['metaValues']);
    }

    private mapVariables(data: '' | {
        vars: {
            var: {
                $: {
                    name: string,
                    pos?: string,
                    lemma?: string
                }
            }[]
        }[]
    }, treeXml: {
        node: {
            0: {
                $: { [key: string]: string | number }
            }
        }
    }): Hit['variableValues'] {
        const rootProps = {
            // the properties of the top node aren't included
            // in the variables
            $node: treeXml?.node?.[0].$ || {}
        };
        if (!data || !data.vars) {
            return rootProps;
        }
        return data.vars[0].var.reduce((values, variable) => {
            values[variable.$.name] = variable.$;
            return values;
        }, rootProps as Hit['variableValues']);
    }

    /**
     * Format variables for sending to the server
     */
    private formatVariables(variables: SearchVariable[]) {
        return variables?.map(variable => ({
            name: variable.name,
            path: variable.path,
            props: this.formatVariableProps(variable.props)
        }));
    }

    private formatVariableProps(props?: SearchVariable['props']) {
        if (!props || props.length === 0) {
            return undefined;
        }

        const result: { [name: string]: string } = {};
        for (const prop of props) {
            if (prop.enabled) {
                result[prop.name] = prop.expression;
            }
        }

        return result;
    }

    private highlightSentence(sentence: string, nodeStarts: number[], tag: string) {
        // translated from treebank-search.php
        let prev: string, next: string;

        if (sentence.indexOf('<em>') >= 0) {
            // Showing the context of this hit
            const $groups = /(.*<em>)(.*?)(<\/em>.*)/.exec(sentence);
            sentence = $groups[2];
            prev = $groups[1];
            next = $groups[3];
        }

        const words = sentence.split(' ');

        // Instead of wrapping each individual word in a tag, merge sequences
        // of words in one <tag>...</tag>
        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            if (nodeStarts.indexOf(i) >= 0) {
                let value = '';
                if (nodeStarts.indexOf(i - 1) === -1) {
                    value += `<${tag}>`;
                }
                value += words[i];
                if (nodeStarts.indexOf(i + 1) === -1) {
                    value += `</${tag}>`;
                }
                words[i] = value;
            }
        }
        let highlightedSentence = words.join(' ');
        if (prev || next) {
            highlightedSentence = prev + ' ' + highlightedSentence + ' ' + next;
        }

        return this.sanitizer.bypassSecurityTrustHtml(highlightedSentence);
    }
}

/**
 * The results as returned by the API. The results consist of an array containing various parts
 * of the results. These are described for each item position below.
 * Each result has an ID which corresponds. For example results[0] contains a dictionary with
 * the plain text sentences, they same keys are used for results[4] containing the xml of
 * each hit.
 */
type ApiSearchResult = {
    results: {
        sentid: string,
        sentence: string,
        prevs: string,
        nexts: string,
        ids: string,
        begins: string,
        xml_sentences: string,
        /**
         * Information from the metadata field of the Alpino XML
         */
        meta: string,
        /**
         * XML containing the attributes for the nodes in the Alpino XML
         * matching the variable selectors.
         */
        variables: string,
        /**
         * Attributes which might be derived programmatically such
         * as the MWE information
         */
        attributes: { [key: string]: string },
        component: string,
        database: string,
    }[],
    query_id: number,
    search_percentage: number,
    errors: string,
    cancelled?: boolean,
    counts: {
        component: string,
        number_of_results: number,
        completed: boolean,
        percentage: number,
    }[],
};

/** Processed search results created from the response */
export interface SearchResults {
    hits: Hit[];
    queryId: number;
    searchPercentage: number;
    errors: string;
    cancelled?: boolean;
    counts: ResultCount[];
}

export interface Hit {
    /** Id of the component this hit originated from */
    component: string;
    /**
     * Id of the database this hit originated from.
     * Usually identical to the component, but may differ in large treebanks - dbs and components are many-to-1.
     * Used to request the full sentence xml
     */
    database: string;
    fileId: string;
    /** The basic sentence this hit was found in, extracted from its xml. */
    sentence: string;
    previousSentence: string;
    nextSentence: string;
    highlightedSentence: SafeHtml;
    /* The XML of the matched portion of the sentence, does not always contain the full xml! */
    treeXml: string;
    /** The ids of the matching nodes */
    nodeIds: number[];
    /** The begin position of the matching nodes */
    nodeStarts: number[];
    metaValues: { [key: string]: string };
    attributes: { [key: string]: string },
    /** Contains the properties of the node matching the variable */
    variableValues: { [variableName: string]: { [propertyKey: string]: string | number } };
}

export interface ResultCount {
    component: string;
    numberOfResults: number;
    completed: boolean;
    percentage: number;
}

export type HitWithOrigin = Hit & {
    provider: string;
    corpus: { name: string };
    componentDisplayName: string;
};


export type FilterValue = FilterByField | FilterByXPath;
export type FilterByField =
    FilterSingleValue
    | FilterRangeValue<string, 'date'>
    | FilterRangeValue<number, 'int'>
    | FilterMultipleValues<string, 'text'>;

export interface FilterValues { [field: string]: FilterValue; }

export interface FilterSingleValue {
    type: 'single';
    dataType: 'text';
    field: string;
    value: string;
}

export interface FilterRangeValue<T, U> {
    type: 'range';
    dataType: U;
    field: string;
    min: T;
    max: T;
}

export interface FilterMultipleValues<T, U> {
    type: 'multiple';
    dataType: U;
    values: Array<T>;
    field: string;
}

export interface FilterByXPath {
    /// The variable name + attribute e.g. $node1.pt
    field: string;
    type: 'xpath';
    label: string;
    location: Location;
    /**
     * The predicate to add to the node to filter it.
     */
    attributeXpath: string;
    /**
     * Selector to add to the entire query to select the node
     * being filtered on. This is necessary if the node cannot be
     * modified in the main query. That can happen if that query has
     * been changed by the user (in the results component).
     */
    contextXpath: string;
}

export interface TreebankCount {
    componentId: string;
    count: number;
}

export interface MetadataValueCounts { [key: string]: { [value: string]: number }; }

type ApiTreeResult = {
    tree?: string,
    error?: string
}
