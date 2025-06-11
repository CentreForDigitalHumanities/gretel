import { Injectable } from '@angular/core';

import { PathVariable, XPathAttributes } from 'lassy-xpath';
import * as _ from 'lodash';

import { Hit } from './results.service';

// use three spaces, this way values can be split
// even if values themselves might contain spaces
const valueSeparator = '   ';

@Injectable()
export class AnalysisService {
    /**
     * If a value is missing for a column, this value is used instead.
     */
    public static placeholder = '(none)';

    public joinValues(values: string[]): string {
        return values.join(valueSeparator);
    }

    public splitValues(values: string): string[] {
        return values.split(valueSeparator);
    }

    /**
     * Creates variable ID representing concatenating attributes
     * from multiple nodes.
     * @param nodes Nodes to select
     * @param attribute The attribute to read from each selected node
     * @returns
     */
    public joinNodesVariableId(nodes: string[] | PathVariable[], attribute: string = undefined): string {
        let nodeNames: string[];
        if (typeof nodes[0] === 'string') {
            nodeNames = <string[]>nodes;
        } else {
            nodeNames = (<PathVariable[]>nodes).map(node => node.name);
        }

        // sort by number (e.g. $node1 before $node2)
        // and make sure $node (without number) is first
        nodeNames.sort((a, b) => parseInt('0' + a.replace(/\D*/, '')) - parseInt('0' + b.replace(/\D*/, '')));

        const variable = nodeNames.join(';');
        if (attribute) {
            return `${variable}.${attribute}`;
        } else {
            return variable;
        }
    }

    public splitNodesVariableId(variable: string) {
        const [nodes, attribute] = variable.split('.');
        const nodeNames = nodes.split(';');
        return {
            nodeNames,
            attribute
        };
    }

    private getRow(variables: { [name: string]: string[] }, metadataKeys: string[], attributeKeys: string[], result: Hit): Row {
        const metadataValues: { [name: string]: string } = {};
        for (const key of metadataKeys) {
            metadataValues[key] = result.metaValues[key];
        }

        const attributeValues: { [name: string]: string } = {};
        for (const key of attributeKeys) {
            attributeValues[key] = result.attributes[key];
        }

        const nodeVariableValues: { [name: string]: NodeProperties } = {};
        for (const name of Object.keys(variables)) {
            const values: { [attribute: string]: string } = {};
            const nodeNames = name.split(';');
            for (const attribute of variables[name]) {
                const combinedValues: string[] = [];
                for (const nodeName of nodeNames) {
                    const node = result.variableValues[nodeName];
                    combinedValues.push($localize`${node && node[attribute] || AnalysisService.placeholder}`);
                }

                values[attribute] = this.joinValues(combinedValues);
            }
            nodeVariableValues[name] = values;
        }

        return { metadataValues, attributeValues, nodeVariableValues };
    }

    /**
     * Gets the attributes found in the hits for a path variable.
     * @param nodeNames Names of the path variables.
     * @param hits The results to search.
     */
    public getNodeAttributes(nodeNames: string[], hits: Hit[]) {
        const availableAttrs: { [key: string]: true } = {};
        for (const hit of hits) {
            for (const nodeName of nodeNames) {
                const values = Object.keys(hit.variableValues[nodeName] ?? {}).filter(a => a !== 'name');
                for (const value of values) {
                    availableAttrs[value] = true;
                }
            }
        }

        return _.sortBy(Object.keys(availableAttrs)).map((attr) => {
            const attribute = XPathAttributes[attr];
            return {
                value: attr,
                label: attribute && attribute.description ? `${attr} (${attribute.description})` : attr
            };
        });
    }

    /**
     * Get a flat table representation of the search results.
     * @param searchResults The results to parse.
     * @param variables The variables and their properties to return, which should be present in the results.
     * @param metadataKeys The metadata keys to return, which should be present in the results.
     * @param attributeKeys The attribute keys to return, which should be present in the results.
     * @returns The first row contains the column names, the preceding the associated values.
     */
    public getFlatTable(searchResults: Hit[], variables: { [name: string]: string[] }, metadataKeys: string[], attributeKeys: string[]): string[][] {
        const rows: Row[] = [];
        const attributeKeysWithoutPrefix = attributeKeys.map(attr => attr.replace(/^#/, ''));
        for (const result of searchResults) {
            const row = this.getRow(variables, metadataKeys, attributeKeysWithoutPrefix, result);
            rows.push(row);
        }

        const columnNames: string[] = [];
        columnNames.push(...metadataKeys);
        columnNames.push(...attributeKeys);

        // remove the starting $ variable identifier
        for (const name of Object.keys(variables)) {
            columnNames.push(...variables[name].map(attr => `${name}.${attr}`));
        }

        // first row contains the column names
        const results = [columnNames];

        for (const row of rows) {
            const line: string[] = [];

            line.push(...metadataKeys.map(key => row.metadataValues[key] || AnalysisService.placeholder));
            line.push(...attributeKeysWithoutPrefix.map(key => row.attributeValues[key] || AnalysisService.placeholder))

            for (const name of Object.keys(variables)) {
                line.push(...variables[name].map(attr => row.nodeVariableValues[name][attr]));
            }

            results.push(line);
        }

        return results;
    }
}

export interface NodeProperties {
    [property: string]: string;
}

export interface Row {
    metadataValues: { [name: string]: string };
    attributeValues: { [name: string]: string };
    nodeVariableValues: { [name: string]: NodeProperties };
}
