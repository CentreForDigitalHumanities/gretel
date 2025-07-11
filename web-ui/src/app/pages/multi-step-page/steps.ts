import { ExtractinatorService, ReconstructorService, PathVariable } from 'lassy-xpath';

import { DefaultTokenAttributes, TokenAttributes } from '../../models/matrix';
import { AlpinoService } from '../../services/alpino.service';
import { TreebankService } from '../../services/treebank.service';
import { FilterValues, SearchVariable, NotificationService, MweQuerySet, MweQuery } from '../../services/_index';
import { TreebankSelection } from '../../treebank';

/**
 * Contains all the steps that are used in the xpath search
 */

/**
 * All the information the xpath-search component should keep track of
 */
interface GlobalState {
    currentStep: Step<this>;
    /**
     * Include context in results (the preceding and following sentence)
     */
    retrieveContext: boolean;
    xpath: string;
    filterValues: FilterValues;
    connectionError: boolean;
    valid: boolean;
    // Question: should this even be in this state?
    loading: boolean;
    inputSentence?: string;
    selectedTreebanks: TreebankSelection;
    /**
     * Query additional custom properties for variables
     */
    variableProperties: {
        // start with $, refers to an existing variable extracted from
        // the query tree
        variableName: string;
        // start with _
        propertyName: string;
        propertyExpression: string;
        enabled: boolean;
    }[];
}

export function getSearchVariables(
    variables: PathVariable[],
    properties: GlobalState['variableProperties']): SearchVariable[] {
    const output = [...variables] as SearchVariable[];
    if (properties) {
        for (const prop of properties) {
            const variable = output.find(v => v.name === prop.variableName);
            if (variable !== undefined) {
                if (!variable.props) {
                    variable.props = [];
                }
                variable.props.push({
                    name: prop.propertyName,
                    expression: prop.propertyExpression,
                    enabled: prop.enabled
                });
            }
        }
    }
    return output;
}

interface GlobalStateExampleBased extends GlobalState {
    isCustomXPath: boolean;
    exampleXml: string;
    subTreeXml: string;
    tokens: string[];
    attributes: TokenAttributes[];
    /**
     * Ignores properties of the dominating node
     */
    ignoreTopNode: boolean;
    /**
     * Respect word order
     */
    respectOrder: boolean;
}

export function IsMweState(state: GlobalState): state is MweState {
    // to make sure this has to be updated on a refactor
    const property: keyof MweState = 'querySet';
    return state.hasOwnProperty(property);
}

export interface MweState extends GlobalState {
    canonicalForm: { text: string, id?: number };
    querySet: MweQuerySet;
    currentQuery: MweQuery;
}

enum StepType {
    SentenceInput,
    CanonicalFormInput,
    Matrix,
    Parse,
    XpathInput,
    Analysis,
    Results,
    SelectTreebanks
}

/**
 * A step has a number and a function that performs the necessary actions when entering a step
 */
abstract class Step<T> {
    constructor(public number: number) {
    }

    abstract type: StepType;

    // Makes sure the step is entered correctly
    abstract enterStep(state: T): Promise<T>;
    abstract leaveStep(state: T): T;
}

class SentenceInputStep<T extends GlobalState> extends Step<T> {
    type = StepType.SentenceInput;

    async enterStep(state: T) {
        state.currentStep = this;
        state.valid = state.inputSentence && state.inputSentence?.trim()?.length > 0;
        return state;
    }

    leaveStep(state: T) {
        return state;
    }
}

class CanonicalFormInputStep<T extends MweState> extends Step<T> {
    type = StepType.CanonicalFormInput;

    async enterStep(state: T) {
        state.currentStep = this;
        state.valid = state.canonicalForm && state.canonicalForm.text?.trim()?.length > 0;
        return state;
    }

    leaveStep(state: T) {
        return state;
    }
}

class MatrixStep extends Step<GlobalStateExampleBased> {
    type = StepType.Matrix;

    constructor(number: number,
        private alpinoService: AlpinoService,
        private extractinatorService: ExtractinatorService,
        private reconstructorService: ReconstructorService,
        private notificationService: NotificationService) {
        super(number);
    }

    async enterStep(state: GlobalStateExampleBased) {
        state.currentStep = this;
        const existingTokens = state.tokens.join(' ');
        const tokenized = this.alpinoService.tokenize(state.inputSentence);
        if (existingTokens !== tokenized) {
            state.tokens = tokenized.split(' ');
        }
        state.attributes = state.tokens.map((val, index) =>
            state.attributes && state.attributes.length > index
                ? {
                    ...DefaultTokenAttributes,
                    ...state.attributes[index]
                }
                : {
                    ...DefaultTokenAttributes
                });
        return this.updateMatrix(state);
    }

    leaveStep(state: GlobalStateExampleBased) {
        return state;
    }

    async updateMatrix(state: GlobalStateExampleBased) {
        if (!state.isCustomXPath) {
            try {
                const generated = await this.alpinoService.generateXPath(
                    state.exampleXml,
                    state.tokens,
                    state.attributes,
                    state.ignoreTopNode,
                    state.respectOrder);
                state.subTreeXml = generated.subTree;
                state.xpath = generated.xpath;
                state.valid = true;
            }
            catch (error) {
                state.connectionError = true;
                state.valid = false;
                this.notificationService.add('Problem generating XPath', 'error');
                console.error(error);
            }
        } else {
            try {
                const paths = this.extractinatorService.extract(state.xpath);
                state.subTreeXml = this.reconstructorService.construct(paths, state.xpath);
            } catch (error) {
                state.valid = false;
            }
        }
        return state;
    }
}

class ParseStep extends Step<GlobalStateExampleBased> {
    type = StepType.Parse;

    constructor(number: number, private alpinoService: AlpinoService) {
        super(number);
    }

    async enterStep(state: GlobalStateExampleBased) {
        state.loading = true;
        state.currentStep = this;
        state.valid = false;

        await this.alpinoService.parseSentence(state.inputSentence)
            .then(xml => {
                state.exampleXml = xml;
                state.valid = true;
            })
            .catch(e => {
                state.connectionError = true;
                state.exampleXml = undefined;
                console.error(e);
            })
            .finally(() => {
                state.loading = false;
            });

        return state;
    }

    leaveStep(state: GlobalStateExampleBased) {
        return state;
    }
}

class XpathInputStep<T extends GlobalState> extends Step<T> {
    type = StepType.XpathInput;

    constructor(number: number) {
        super(number);
    }

    async enterStep(state: T) {
        state.currentStep = this;
        state.valid = true;
        return state;
    }

    leaveStep(state: T) {
        return state;
    }
}

class AnalysisStep<T extends GlobalState> extends Step<T> {
    type = StepType.Analysis;

    constructor(number: number) {
        super(number);
    }

    /**
     * Gets the results before going the next state.
     * @param state
     * @returns
     */
    async enterStep(state: T) {
        state.currentStep = this;
        return state;
    }

    /**
     * Makes sure the stream is ended
     * @param state
     * @returns {GlobalState}
     */
    leaveStep(state: T): T {
        state.loading = false;
        return state;
    }
}

class ResultsStep<T extends GlobalState> extends Step<T> {
    type = StepType.Results;

    constructor(number: number) {
        super(number);
    }

    /**
     * Gets the results before going the next state.
     * @param state
     * @returns
     */
    async enterStep(state: T) {
        state.currentStep = this;
        state.valid = true;
        return state;
    }

    /**
     * Makes sure the stream is ended
     * @param state
     * @returns {T}
     */
    leaveStep(state: T): T {
        state.loading = false;
        return state;
    }
}

class SelectTreebankStep<T extends GlobalState> extends Step<T> {
    type = StepType.SelectTreebanks;

    constructor(public number: number, protected treebankService: TreebankService) {
        super(number);
    }

    /**
     * Must first do a pre treebank step
     * @param state
     * @returns the updates state
     */
    async enterStep(state: T) {
        state.currentStep = this;
        state.valid = state.selectedTreebanks.hasAnySelection();
        return state;
    }

    leaveStep(state: T) {
        return state;
    }
}

export {
    GlobalState,
    GlobalStateExampleBased,
    Step,
    StepType,
    AnalysisStep,
    XpathInputStep,
    SelectTreebankStep,
    ResultsStep,
    SentenceInputStep,
    CanonicalFormInputStep,
    ParseStep,
    MatrixStep
};
