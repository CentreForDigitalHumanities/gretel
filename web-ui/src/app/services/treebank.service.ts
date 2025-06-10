import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';

import { BehaviorSubject, Observable, ReplaySubject, merge, EMPTY } from 'rxjs';
import { flatMap, mergeMap, catchError, shareReplay, delay, map, first } from 'rxjs/operators';

import {
    ComponentGroup,
    FuzzyNumber,
    Treebank,
    TreebankComponent,
    TreebankComponents,
    TreebankDetails,
    TreebankMetadata
} from '../treebank';
import { ConfigurationService } from './configuration.service';
import { NotificationService } from './notification.service';

/**
 * Dummy component which is used to mark that a component is missing
 * and should always be disabled and unselectable
 */
export const MISSING_COMPONENT_ID = '#MISSING#';

export interface TreebankLookup {
    providers: { name: string, corpora: Set<string> }[];
    data: {
        [provider: string]: {
            [corpus: string]: Treebank;
        }
    };
}
export interface ConfiguredTreebanksResponse {
    [treebank: string]: {
        components: {
            [component: string]: {
                id: string,
                title: string,
                description: string,
                sentences: number | '?',
                words: number | '?',
                group?: string,
                variant?: string,
                disabled?: boolean
            }
        },
        groups?: {
            [group: string]: {
                description: string
            }
        },
        variants?: {
            [variant: string]: {
                display: string
            }
        },
        description: string,
        title: string,
        metadata: {
            field: string,
            type: 'text' | 'int' | 'date',
            facet: 'checkbox' | 'slider' | 'range' | 'dropdown',
            show: boolean,
            minValue?: number | Date,
            maxValue?: number | Date,
        }[],
        multioption?: boolean
    };
}

export interface UploadedTreebankResponse {
    email: string;
    id: string;
    processed: string;
    public: '1' | '0';
    title: string;
    uploaded: string;
    user_id: string;
}

export interface DjangoTreebankResponse {
    slug: string;
    title: string;
    description: string;
    url_more_info: string;
    groups?: {
        slug: string;
        description: string
    }[];
    variants?: string[];
}

interface UploadedTreebankMetadataResponse {
    id: string;
    treebank_id: string;
    field: string;
    type: 'text' | 'int' | 'date';
    facet: 'checkbox' | 'slider' | 'date_range';
    min_value: string | null;
    max_value: string | null;
    show: '1' | '0';
}

interface DjangoTreebankMetadataResponse {
    field: string;
    type: 'text' | 'int' | 'date';
    facet: 'checkbox' | 'slider' | 'range';
    min_value: string | null;
    max_value: string | null;
}

// not quite sure what this is yet
interface UploadedTreebankShowResponse {
    basex_db: string;
    nr_sentences: string;
    nr_words: string;
    slug: string;
    title: string;
}

export interface DjangoComponentsForTreebankResponse {
    slug: string;
    title: string;
    description: string;
    nr_sentences: string;
    nr_words: string;
    group?: string;
    variant?: string;
}

class LazyRetrieve<T> {
    value?: Promise<T | undefined>;
    get(): Promise<T | undefined> {
        return this.value || (this.value = this.retriever()
            .catch((reason: HttpErrorResponse) => {
                NotificationService.addError(reason);
                return undefined;
            }));
    }

    constructor(private retriever: () => Promise<T>) {
        this.get = this.get.bind(this);
    }
}

abstract class TreebankBase implements Treebank {
    provider: string; id: string;
    displayName: string;
    description?: string;
    multiOption: boolean;
    isPublic: boolean;
    userId?: number;
    email?: string;
    uploaded?: Date;
    processed?: Date;
    details: { [T in keyof TreebankDetails]: () => Promise<TreebankDetails[T] | undefined> };
}

class LazyTreebank extends TreebankBase {
    constructor(
        values: Pick<Treebank, Exclude<keyof Treebank, 'details'>>,
        retrievers: {
            [T in keyof Treebank['details']]: Treebank['details'][T]
        }) {
        super();
        Object.assign(this, values);

        this.details = {
            metadata: new LazyRetrieve(retrievers.metadata).get,
            components: new LazyRetrieve(retrievers.components).get,
            componentGroups: new LazyRetrieve(retrievers.componentGroups).get,
            variants: new LazyRetrieve(retrievers.variants).get
        };
    }
}

export class ReadyTreebank extends TreebankBase {
    constructor(
        values: Pick<Treebank, Exclude<keyof Treebank, 'details'>>,
        details: TreebankDetails) {
        super();
        Object.assign(this, values);

        this.details = {
            metadata: () => Promise.resolve(details.metadata),
            components: () => Promise.resolve(details.components),
            componentGroups: () => Promise.resolve(details.componentGroups),
            variants: () => Promise.resolve(details.variants)
        };
    }
}

function makeUploadedMetadata(item: UploadedTreebankMetadataResponse): TreebankMetadata {
    const metadata: TreebankMetadata = {
        field: item.field,
        type: item.type,
        facet: item.facet === 'date_range' ? 'range' : item.facet,
        show: item.show === '1'
    };

    if (['slider', 'range'].includes(metadata.facet)) {
        switch (metadata.type) {
            case 'int':
                metadata.minValue = parseInt(item.min_value, 10);
                metadata.maxValue = parseInt(item.max_value, 10);
                return metadata;
            case 'date':
                metadata.minValue = new Date(item.min_value);
                metadata.maxValue = new Date(item.max_value);
                return metadata;
        }
    }

    return metadata;
}

function makeDjangoMetadata(item: DjangoTreebankMetadataResponse): TreebankMetadata {
    const metadata: TreebankMetadata = {
        field: item.field,
        type: item.type,
        facet: item.facet,
        show: true
    }

    if (['slider', 'range'].includes(metadata.facet)) {
        switch (metadata.type) {
            case 'int':
                metadata.minValue = parseInt(item.min_value, 10);
                metadata.maxValue = parseInt(item.max_value, 10);
                return metadata;
            case 'date':
                metadata.minValue = new Date(item.min_value);
                metadata.maxValue = new Date(item.max_value);
                return metadata;
        }
    }

    return metadata;
}

function makeUploadedComponent(comp: UploadedTreebankShowResponse): TreebankComponent {
    return {
        description: '',
        disabled: false,
        id: 'GRETEL-UPLOAD-' + comp.basex_db,
        sentenceCount: parseInt(comp.nr_sentences, 10),
        title: comp.title,
        wordCount: parseInt(comp.nr_words, 10),

        group: undefined,
        variant: undefined,
    };
}

function makeDjangoComponent(comp: DjangoComponentsForTreebankResponse): TreebankComponent {
    return {
        description: comp.description,
        disabled: false,
        id: comp.slug,
        sentenceCount: parseInt(comp.nr_sentences, 10),
        title: comp.title,
        wordCount: parseInt(comp.nr_words, 10),

        group: comp.group,
        variant: comp.variant,
    }
}

function makeUploadedTreebank(provider: string, bank: UploadedTreebankResponse): Pick<Treebank, Exclude<keyof Treebank, 'details'>> {
    return {
        id: 'GRETEL-UPLOAD-' + bank.title,
        displayName: bank.title,
        description: undefined,
        isPublic: bank.public === '1',
        multiOption: true,
        provider,
        userId: parseInt(bank.user_id, 10),
        email: bank.email,
        uploaded: new Date(bank.uploaded),
        processed: new Date(bank.processed),
    };
}

function makeDjangoTreebank(bank: DjangoTreebankResponse): Pick<Treebank, Exclude<keyof Treebank, 'details'>> {
    return {
        id: bank.slug,
        displayName: bank.title,
        description: bank.description,
        isPublic: true,
        multiOption: true,
        provider: 'gretel',
    }
}

@Injectable()
export class TreebankService {
    /**
     * Use getTreebanks to start loading.
     * Some treebanks may become available here before it is done.
     */
    public readonly treebanks = new BehaviorSubject<TreebankLookup>({ providers: [], data: {} });

    private treebanksLoader: Promise<void>;

    constructor(private configurationService: ConfigurationService, private http: HttpClient) {
    }

    public async get(provider: string, corpus: string) {
        const get = (treebankLookup: TreebankLookup) => {
            const treebanks = treebankLookup.data[provider];
            return treebanks && treebanks[corpus];
        };

        return get(this.treebanks.value) || this.getTreebanks() && this.treebanks.pipe(
            map(treebanks => get(treebanks)),
            first(treebank => !!treebank)).toPromise();
    }

    /**
     * Completes when all providers have been queried.
     */
    public async getTreebanks(): Promise<TreebankLookup> {
        if (!this.treebanksLoader) {
            this.treebanksLoader = this.loadAll();
        }
        await this.treebanksLoader;
        return this.treebanks.value;
    }

    private async loadAll() {
        const allTreebanks$ = merge(this.getDjangoTreebanks(), this.getUploadedTreebanks()).pipe(shareReplay()).pipe(delay(0));
        allTreebanks$.subscribe((treebank) => {
            if (treebank) {
                const current = this.treebanks.value;
                const provider = current.providers.find(p => p.name === treebank.provider);
                if (provider) {
                    provider.corpora.add(treebank.id);
                } else {
                    current.providers.push({ name: treebank.provider, corpora: new Set([treebank.id]) });
                }
                this.treebanks.next({
                    providers: current.providers,
                    data: {
                        ...current.data,
                        [treebank.provider]: {
                            ...current.data[treebank.provider],
                            [treebank.id]: treebank
                        }
                    }
                });
            }
        });

        // toPromise() resolves only when the underlying stream completes.
        await allTreebanks$.toPromise();
    }

    private getUploadedTreebanks(): Observable<Treebank> {
        const ob = new ReplaySubject<Treebank>();

        (async () => {
            const uploadProvider = await this.configurationService.getUploadProvider();
            if (!uploadProvider) {
                // Ob already returned in outer scope!
                ob.complete();
                return; // return to outer scope
            }
            const uploadUrl = await this.configurationService.getUploadApiUrl('treebank');

            this.http.get<UploadedTreebankResponse[]>(uploadUrl,
                {
                    withCredentials: true
                })
                .pipe(
                    // unpack array
                    flatMap(r => r),
                    // gather the rest of the data and unpack promise
                    map(r => this.getUploadedTreebank(uploadProvider, r)),
                    // catch errors (either from initial get, or the above async mapping operation)
                    catchError((error: HttpErrorResponse) => {
                        NotificationService.addError(error);
                        return EMPTY;
                    })
                )
                .subscribe(ob);
        })();

        return ob;
    }

    private getDjangoTreebanks(): Observable<Treebank> {
        const ob = new ReplaySubject<Treebank>();

        // Not working with providers for now

        (async () => {
            const djangoUrl = await this.configurationService.getDjangoUrl('treebanks/treebank/');

            this.http.get<DjangoTreebankResponse[]>(djangoUrl)
                .pipe(
                    mergeMap(r => r),
                    map(r => this.getDjangoTreebank(r)),
                    catchError((error: HttpErrorResponse) => {
                        NotificationService.addError(error);
                        return EMPTY;
                    })
                )
                .subscribe(ob);
        })();

        return ob;
    }

    private getUploadedTreebank(provider: string, bank: UploadedTreebankResponse): Treebank {
        return new LazyTreebank(
            makeUploadedTreebank(provider, bank),
            {
                metadata: async () => {
                    const uploadedMetadata = await this.configurationService.getUploadApiUrl('treebank/metadata/' + bank.title)
                        .then(url => this.http.get<UploadedTreebankMetadataResponse[]>(url, { withCredentials: true }).toPromise());
                    return uploadedMetadata.map(makeUploadedMetadata);
                },
                componentGroups: async () => undefined,
                components: async () => {
                    const uploadedComponents = await this.configurationService.getUploadApiUrl('treebank/show/' + bank.title)
                        .then(url => this.http.get<UploadedTreebankShowResponse[]>(url, { withCredentials: true }).toPromise());

                    const components: TreebankComponent[] = uploadedComponents.map(makeUploadedComponent);
                    return components.reduce<TreebankComponents>((cs, c) => { cs[c.id] = c; return cs; }, {});
                },
                variants: async () => undefined
            });
    }

    private async getDjangoComponents(bank: DjangoTreebankResponse) {
        const djangoComponents = await this.configurationService.getDjangoUrl('treebanks/treebank/' + bank.slug + '/components/')
            .then(url => this.http.get<DjangoComponentsForTreebankResponse[]>(url, {}).toPromise());

        const components: TreebankComponent[] = djangoComponents.map(makeDjangoComponent);
        return components.reduce<TreebankComponents>((cs, c) => { cs[c.id] = c; return cs; }, {});
    }

    private getDjangoTreebank(bank: DjangoTreebankResponse): Treebank {
        const components = new LazyRetrieve(async () => await this.getDjangoComponents(bank));
        return new LazyTreebank(
            makeDjangoTreebank(bank),
            {
                metadata: async () => {
                    const djangoMetadata = await this.configurationService.getDjangoUrl('treebanks/treebank/' + bank.slug + '/metadata/')
                        .then(url => this.http.get<{ 'metadata': DjangoTreebankMetadataResponse[] }>(url, {}).toPromise());
                    return djangoMetadata.metadata.map(makeDjangoMetadata);
                },
                componentGroups: async () => {
                    // are the components grouped?
                    if (bank.groups?.length < 2) {
                        return undefined;
                    }

                    const groups: { [key: string]: ComponentGroup } = {};
                    for (const component of Object.values(await components.get())) {
                        if (component.group) {
                            if (!groups[component.group]) {
                                groups[component.group] = {
                                    components: { [component.variant]: component.id },
                                    key: component.group,
                                    sentenceCount: new FuzzyNumber(component.sentenceCount),
                                    wordCount: new FuzzyNumber(component.wordCount),
                                    description: component.description
                                }
                            } else {
                                const group = groups[component.group];
                                group.components[component.variant] = component.id;
                                group.sentenceCount.add(component.sentenceCount);
                                group.wordCount.add(component.wordCount);
                            }
                        }
                    }

                    // add missing components for variants
                    if (bank.variants?.length > 1) {
                        for (const group of bank.groups) {
                            for (const variant of bank.variants) {
                                if (!groups[group.slug].components[variant]) {
                                    groups[group.slug].components[variant] = MISSING_COMPONENT_ID;
                                }
                            }
                        }
                    }

                    return Object.values(groups).sort(
                        (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
                },
                components: async () => { return await components.get(); },
                variants: async () => {
                    // should the components (also) be grouped by variant?
                    return bank.variants?.length > 1 ? [...bank.variants] : undefined;
                },
            }
        )
    }
}
