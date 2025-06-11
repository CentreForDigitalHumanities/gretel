import { Injectable, SecurityContext } from '@angular/core';
import { $localize } from '@angular/localize/init';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { saveAs } from 'file-saver';
import { Hit, SearchVariable } from './results.service';
import JSZip from 'jszip';

// Separator for variable values, this shouldn't be the name of
// either the variable name or node property
const KEY_SEPARATOR = '.';

@Injectable()
export class DownloadService {
    constructor(private sanitizer: DomSanitizer) {
    }

    public downloadDistributionList(counts: {
        provider: string,
        corpus: string,
        component: string,
        hits: number,
        sentences: string
    }[]) {
        const rows = [this.formatCsvRow('Provider', 'Treebank', 'Component', 'Hits', 'All Sentences')];
        for (const count of counts) {
            rows.push(this.formatCsvRow(count.provider, count.corpus, count.component, count.hits, count.sentences));
        }

        this.downloadRows('gretel-distribution.csv', 'text/csv', rows);
    }

    public async downloadResults(
        results: { corpus: string, components: string[], xpath: string, hits: Hit[] }[],
        variables?: SearchVariable[]) {
        const zip = new JSZip();
        const corporaNames: string[] = [];
        results.forEach(({ corpus, components, xpath, hits }) => {
            zip.file(
                `${corpus}.meta.txt`,
                this.blob(
                    'text/plain',
                    [`Corpus:\n\t${corpus}
Components:\n\t${components.join('-')}
XPath:\n\t${xpath.split('\n').join('\n\t')}
Date:\n\t${new Date()}
${this.variablesMetaText(variables)}`]));
            corporaNames.push(corpus);

            let variableColumns: string[] = [];
            const variableColumnPositions: { [key: string]: number } = {};

            if (variables) {
                // determine the columns
                const variableProperties = new Set<string>();
                for (const hit of hits) {
                    for (const [variable, properties] of Object.entries(hit.variableValues)) {
                        for (const property of Object.keys(properties)) {
                            const key = `${variable}${KEY_SEPARATOR}${property}`;
                            variableProperties.add(key);
                        }
                    }
                }

                variableColumns = [...variableProperties.values()].sort();
                for (let i = 0; i < variableColumns.length; i++) {
                    variableColumnPositions[variableColumns[i]] = i;
                }
            }

            const rows: string[] = [this.formatCsvRow(
                '#',
                'ID',
                'Corpus',
                'Component',
                'Sentence',
                ...variableColumns)];

            for (let i = 0; i < hits.length; i++) {
                const hit = hits[i];
                const variableCells = variableColumns.map(_ => '');
                if (variables) {
                    for (const [variable, properties] of Object.entries(hit.variableValues)) {
                        for (const [property, value] of Object.entries(properties)) {
                            const key = `${variable}${KEY_SEPARATOR}${property}`;
                            variableCells[variableColumnPositions[key]] = $localize`${value}`;
                        }
                    }
                }

                rows.push(this.formatCsvRow(
                    i + 1,
                    hit.fileId,
                    corpus,
                    hit.component,
                    this.highlightSentence(hit.highlightedSentence),
                    ...variableCells));
            }

            zip.file(`${corpus}.csv`, this.blob('text/csv', rows));
        });
        const content = await zip.generateAsync({ type: 'blob' });
        saveAs(content, `gretel-${corporaNames.join('-')}-${this.timestamp()}.zip`);
    }

    public downloadXPath(xpath: string) {
        this.downloadRows('gretel-xpath.txt', 'text/plain', [xpath]);
    }

    public downloadXml(filename: string, xml: string) {
        saveAs(new Blob([xml], { type: `text/xml;charset=utf-8` }), filename);
    }

    public downloadFilelist(filenames: string[], name: string, header?: string, extension: string = '.fl') {
        if (!header) {
            header = name;
        }
        saveAs(new Blob([`${header}\n${filenames.join('\n')}`], { type: 'text/txt' }), `${name}${extension}`);
    }

    private timestamp() {
        const now = new Date();
        return [now.getUTCFullYear(),
        (now.getUTCMonth() + 1).toString().padStart(2, '0'),
        now.getUTCDate().toString().padStart(2, '0'),
        now.getUTCHours().toString().padStart(2, '0'),
        now.getUTCMinutes().toString().padStart(2, '0'),
        now.getUTCSeconds().toString().padStart(2, '0'),
        ].join('');
    }

    private highlightSentence(highlightedSentence: SafeHtml) {
        return this.sanitizer.sanitize(SecurityContext.HTML, highlightedSentence)
            .replace(/<strong>/g, '<hit>')
            .replace(/<\/strong>/g, '</hit>');
    }

    private formatCsvRow(...data: any[]) {
        return data.map(cell => `${cell}`)
            .map(cell => /[,\n"]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell).join(',') + '\n';
    }

    private blob(fileType: 'text/csv' | 'text/plain', rows: string[]) {
        return new Blob(rows, { type: `${fileType};charset=utf-8`, endings: 'native' });
    }

    private downloadRows(filename: string, fileType: 'text/csv' | 'text/plain', rows: string[]) {
        saveAs(this.blob(fileType, rows), filename);
    }

    private variablesMetaText(variables?: SearchVariable[]) {
        return variables ?
            `Variables:\n${variables.map(variable => this.variableMetaText(variable)).join('\n')}\n`
            : '';
    }

    private variableMetaText(variable: SearchVariable) {
        let metaText = `\t${variable.name}:\n\t\t${variable.path}`;
        if (variable.props) {
            for (const { name, expression } of variable.props) {
                metaText += `\n\t${variable.name}.${name}:\n\t\t${expression}`;
            }
        }
        return metaText;
    }
}
