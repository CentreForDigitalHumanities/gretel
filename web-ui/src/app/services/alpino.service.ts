import { Injectable } from '@angular/core';
import { HttpClient } from "@angular/common/http";
import { ParserService } from 'lassy-xpath';
import { ConfigurationService } from "./configuration.service";
import { TokenAttributes, FilterValue, DefaultTokenAttributes } from '../models/matrix';
import { firstValueFrom } from 'rxjs';

type ApiParseResult = {
    parsed_sentence?: string,
    error?: string
}

@Injectable()
export class AlpinoService {
    generateXPathUrl: Promise<string>;

    constructor(private configurationService: ConfigurationService, private http: HttpClient, private parserService: ParserService) {
        this.generateXPathUrl = configurationService.getDjangoUrl('parse/generate-xpath/');
    }

    async generateXPath(xml: string, tokens: string[], attributes: TokenAttributes[], ignoreTopNode: boolean, respectOrder: boolean) {
        const result = await firstValueFrom(this.http.post<{
            xpath: string,
            subTree: string
        }>(await this.generateXPathUrl, {
            xml,
            tokens,
            attributes: this.attributesToStrings(attributes),
            ignoreTopNode,
            respectOrder
        }));

        return {
            xpath: this.parserService.format(result.xpath),
            subTree: result.subTree
        };
    }

    async parseSentenceUrl(sentence: string) {
        return this.configurationService.getAlpinoUrl('parse_sentence/' + this.escapeSlash(this.tokenize(sentence)));
    }

    async parseSentence(sentence: string) {
        const response = await firstValueFrom(this.http.post<ApiParseResult>(
            await this.configurationService.getDjangoUrl('parse/parse-sentence/'),
            { sentence: sentence }
        ));
        return response.parsed_sentence;
    }

    attributesToStrings(attrs: TokenAttributes[], skipDefault = false): string[] {
        if (attrs === undefined) {
            return undefined;
        }

        return attrs.map(attr => {
            let parts: string[] = [];

            for (let key of ['na', 'cs']) {
                if (!skipDefault || attr[key] !== DefaultTokenAttributes[key]) {
                    // this token is ignored - don't parse the remaining tokens
                    if (key === 'na' && attr['na']) {
                        return 'na';
                    }
                    if (attr[key]) {
                        parts.push(key);
                    }
                }
            }

            for (let key of ['rel', 'word', 'lemma', 'pt', 'postag']) {
                switch (attr[key]) {
                    case skipDefault && DefaultTokenAttributes[key]:
                        // don't set default values
                        break;

                    case 'include':
                        parts.push(key);
                        break;

                    case 'exclude':
                        parts.push(`-${key}`);
                        break;

                    default:
                        parts.push(`~${key}`);
                        break;
                }
            }

            return parts.join(',');
        });
    }

    attributesFromString(strings: string[]): TokenAttributes[] {
        if (strings === undefined) {
            return undefined;
        }

        return strings.map(string => {
            let parts: string[] = string.split(',');
            let attributes: TokenAttributes = {
                ...DefaultTokenAttributes
            };

            const notApplicable = parts.indexOf('na') >= 0;
            if (notApplicable) {
                parts = Object.keys(DefaultTokenAttributes)
                    .filter(key => key != 'cs')
                    .map(key => `~${key}`);
            }

            for (let part of parts) {
                const key = part.replace(/^[-~]/, '');
                switch (key) {
                    case 'cs':
                    case 'na':
                        attributes[key] = true;
                        break;

                    case 'rel':
                    case 'word':
                    case 'lemma':
                    case 'pt':
                    case 'postag':
                        let value: FilterValue;
                        switch (part[0]) {
                            case '-':
                                value = 'exclude';
                                break;

                            case '~':
                                value = undefined;
                                break;

                            default:
                                value = 'include';
                                break;
                        }
                        attributes[key] = value;
                        break;
                }
            }

            return attributes;
        });
    }

    tokenize(sentence: string) {
        // Add space before and after punctuation marks
        return sentence.replace(/([<>\.\,\:\;\?!\(\)\"\\\/])/g, ' $1 ')
            // Deal wth ...
            .replace(/(\.\s+\.\s+\.)/g, ' ... ')
            // Delete first and last space(s)
            .replace(/^\s*(.*?)\s*$/g, '$1')
            // Change multiple spaces to single space
            .replace(/\s+/g, ' ');
    }

    /**
     * The slash is decoded before the router parses the address,
     * mayhem ensues.
     * So it needs to be escaped in some magic way.
     * @param sentence
     */
    escapeSlash(sentence: string) {
        return encodeURIComponent(sentence.replace(/\//g, '_SLASH_'));
    }
}
