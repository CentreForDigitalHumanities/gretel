import { Observable } from "rxjs";

export class FuzzyNumber {
    public value = 0;
    public unknown = false;
    constructor(value: number | '?') {
        if (value === '?') {
            this.unknown = true;
        } else {
            this.value = value;
        }
    }

    /**
     * Adds a value to this number and modifies this instance.
     * @param value
     */
    public add(value: number | '?') {
        if (value === '?') {
            this.unknown = true;
        } else {
            this.value += value;
        }
    }

    public toString() {
        if (this.unknown) {
            if (this.value === 0) {
                return '?';
            } else {
                return '≥ ' + this.value.toString();
            }
        } else {
            return this.value.toString();
        }
    }

    public toLocaleString() {
        if (this.unknown) {
            if (this.value === 0) {
                return '?';
            } else {
                return '≥ ' + this.value.toLocaleString();
            }
        } else {
            return this.value.toLocaleString();
        }
    }
}

export interface Treebank {
    /** The backend this corpus resides in */
    provider: string;
    /** Id of this treebank */
    id: string;
    /**
     * The user-friendly title to use, uploaded treebanks have the same
     * value here as the treebank's name.
     */
    displayName: string;
    description?: string;
    /** Can the user search in multiple components simultaneously for this treebank */
    multiOption: boolean;
    /** Might be false for user-uploaded corpora */
    isPublic: boolean;

    // The following options only exist for user-uploaded treebanks
    userId?: number;
    email?: string;
    /** When this has been uploaded */
    uploaded?: Date;
    processed?: Date;

    details: { [T in keyof TreebankDetails]: () => Promise<TreebankDetails[T] | undefined> };
}

export interface TreebankDetails {
    metadata: TreebankMetadata[];
    components: TreebankComponents;
    componentGroups: ComponentGroup[];
    variants: string[];
}

export interface ComponentGroup {
    key: string;
    /**
     * values are component IDs
     */
    components: { [variant: string]: string };
    description?: string;
    sentenceCount: FuzzyNumber;
    wordCount: FuzzyNumber;
}

/**
 * Component of a treebank.
 */
export interface TreebankComponent {
    /** Serverside id  */
    id: string;
    /** Friendly name */
    title: string;
    sentenceCount: number | '?';
    wordCount: number | '?';
    description: string;
    disabled: boolean;

    /** The ComponentGroup */
    group?: string;
    /** The Variant */
    variant?: string;
}

export interface TreebankComponents {
    [id: string]: TreebankComponent;
}

export interface TreebankMetadata {
    field: string;
    type: 'text' | 'int' | 'date';
    facet: 'checkbox' | 'slider' | 'range' | 'dropdown';
    show: boolean;
    minValue?: number | Date;
    maxValue?: number | Date;
}

export class TreebankSelection {
    /**
     * Gets all the selected corpora
     */
    get corpora() {
        return this.providers
            .flatMap((provider) => provider.corpora.map(corpus => ({ provider: provider.name, corpus })));
    }

    /**
     * Gets all the selected providers
     */
    get providers() {
        return Object.entries(this.data)
            .map(([provider, data]) => {
                return {
                    name: provider,
                    corpora: Object.entries(data)
                        .filter(([corpus, selection]) => selection.selected)
                        .map(([corpus, selection]) => {
                            const components = selection.components;
                            return {
                                name: corpus,
                                components: Object.entries(components)
                                    .filter(([component, selected]) => selected)
                                    .map(([component, selected]) => component),
                                treebank: this.treebankService.get(provider, corpus)
                            };
                        })
                };
            });
    }

    data: TreebankSelectionData;

    encode() {
        const encoded: { [provider: string]: { [corpus: string]: string[] } } = {};
        let any = false;
        for (const [provider, corpora] of Object.entries(this.data)) {
            for (const [corpus, selection] of Object.entries(corpora)) {
                if (selection.selected) {
                    for (const [component, selected] of Object.entries(selection.components)) {
                        if (selected) {
                            const providerCorpora = encoded[provider] || (encoded[provider] = {});
                            const components = providerCorpora[corpus] || (providerCorpora[corpus] = []);
                            components.push(component);
                            any = true;
                        }
                    }
                }
            }
        }

        return any ? encoded : undefined;
    }

    equals(other: TreebankSelection) {
        const providers = this.providers;
        if (providers.length !== other.providers.length) {
            return false;
        }
        for (let i = 0; i < other.providers.length; i++) {
            const provider = providers[i];
            const otherProvider = other.providers[i];

            if (provider.name !== otherProvider.name) {
                return false;
            }

            if (provider.corpora.length !== otherProvider.corpora.length) {
                return false;
            }

            for (let j = 0; j < otherProvider.corpora.length; j++) {
                const corpus = provider.corpora[j];
                const otherCorpus = otherProvider.corpora[j];
                if (corpus.name !== otherCorpus.name) {
                    return false;
                }

                if (corpus.components.length !== otherCorpus.components.length) {
                    return false;
                }

                for (let k = 0; k < otherCorpus.components.length; k++) {
                    if (corpus.components[k] !== otherCorpus.components[k]) {
                        return false;
                    }
                }
            }
        }

        return true;
    }

    hasAnySelection() {
        for (const corpora of Object.values(this.data)) {
            for (const selection of Object.values(corpora)) {
                if (selection.selected && Object.values(selection.components).some(x => x)) {
                    return true;
                }
            }
        }
        return false;
    }

    isSelected(providerName: string, corpusName: string, componentId: string = null) {
        const provider = this.data[providerName];
        if (!provider) {
            return false;
        }
        const corpus = provider[corpusName];
        if (!corpus) {
            return false;
        }
        if (!componentId) {
            return corpus.selected;
        }

        return corpus.components[componentId];
    }

    constructor(private treebankService: TreebankService, state: ReturnType<TreebankSelection['encode']> = {}) {
        this.data = {};
        function databaseName(corpus: string, component: string) {
            return corpus.toUpperCase().replace('-', '_') + `_ID_${component}`;
        }
        if ('corpus' in state && 'components' in state) {
            // conversion of pre-federated URLs
            state = {
                gretel: {
                    [(state as any).corpus]: (state['components'] as any as string[])
                        .map(component => databaseName((state as any).corpus, component))
                }
            } as any;
        }

        for (const provider of Object.keys(state)) {
            this.data[provider] = {};
            for (const corpus of Object.keys(state[provider])) {
                const treebankState: CorpusSelection = { selected: true, components: {} };
                this.data[provider][corpus] = treebankState;
                for (const component of state[provider][corpus]) {
                    treebankState.components[component] = true;
                }
            }
        }
    }

    clone() {
        const clone = new TreebankSelection(this.treebankService);
        for (const [provider, corpora] of Object.entries(this.data)) {
            clone.data[provider] = { ...corpora };
        }
        return clone;
    }
}

// To prevent a circular dependency (actual TreebankService needs this file)
interface TreebankService {
    get(corpora: string, corpus: string): Promise<Treebank>;
}

export interface TreebankSelectionData {
    [provider: string]: { [corpus: string]: CorpusSelection };
}

export interface CorpusSelection {
    selected: boolean;
    components: { [component: string]: boolean };
}
