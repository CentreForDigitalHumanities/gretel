import { Injectable } from '@angular/core';
import { StateService } from './state.service';
import { MISSING_COMPONENT_ID, TreebankService } from './treebank.service';
import { GlobalState, StepType } from '../pages/multi-step-page/steps';
import { Treebank, TreebankDetails, CorpusSelection, TreebankSelection } from '../treebank';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

type DetailLookup<T extends keyof TreebankDetails> = Pick<TreebankDetails, T>;

@Injectable({
    providedIn: 'root'
})
export class TreebankSelectionService {
    get state$(): Observable<TreebankSelection> {
        return this.stateService.state$.pipe(map(state => state.selectedTreebanks));
    }

    constructor(private treebankService: TreebankService, private stateService: StateService<GlobalState>) {
    }

    /**
     * Set the selected state for this bank, or toggle it if no new state is provided.
     *
     * @param provider
     * @param corpus
     * @param selected
     */
    async toggleCorpus(provider: string, corpus: string, selected?: boolean) {
        // select all the components if a treebank is selected for the first time
        let selectComponents = false;
        await this.updateTreebankState(provider, corpus, [],
            (_, state) => {
                selectComponents = (!state || !Object.keys(state.components).length) &&
                    (selected === undefined || selected);
                if (!state) {
                    return {
                        components: {},
                        selected: selected === undefined || selected
                    };
                }
                state.selected = selected === undefined ? !state.selected : selected;
                return state;
            });
        if (selectComponents) {
            return this.toggleComponents(provider, corpus, true);
        }
    }

    /**
     * Set the selected state for this component, or toggle it if no new state is provided.
     * Other components are untouched, unless the bank does not support multiOption.
     * If no components are selected after toggling, the bank itself is also deselected.
     *
     * @param provider
     * @param corpus
     * @param selected
     */
    async toggleComponent(provider: string, corpus: string, componentId: string, selected?: boolean) {
        this.updateTreebankState(provider, corpus, ['components'],
            (treebank, state, details) => {
                selected = selected != null ? selected : !state.components[componentId];
                let anySelected = false;
                Object.values(details.components).forEach(c => {
                    if (c.id === componentId) {
                        state.components[c.id] = selected;
                    } else if (!treebank.multiOption) {
                        state.components[c.id] = false;
                    }

                    anySelected = anySelected || state.components[c.id];
                });

                state.selected = anySelected;
                return state;
            },
            (details) => details.components[componentId] && !details.components[componentId].disabled);
    }

    async toggleComponents(provider: string, corpus: string, selected?: boolean) {
        this.updateTreebankState(provider, corpus, ['components'],
            (treebank, state, details) => {
                const enabledComponents = Object.values(details.components).filter(c => !c.disabled);
                selected = selected != null
                    ? selected
                    : !enabledComponents.every(c => state.components[c.id]);
                Object.values(enabledComponents).forEach(c => state.components[c.id] = selected);
                if (!treebank.multiOption) {
                    // select only one component
                    enabledComponents.slice(1).forEach(c => state.components[c.id] = false);
                }

                state.selected = selected;
                return state;
            });
    }

    /**
     * Set the selected state for all components in this group, or toggle it if no new state is provided.
     * Other components are untouched, unless the bank does not support multiOption.
     * If components are selected after toggling, the bank itself is also deselected.
     *
     * @param provider
     * @param corpus
     * @param selected
     */
    async toggleComponentGroup(provider: string, corpus: string, groupKey: string, selected?: boolean) {
        this.updateTreebankState(provider, corpus, ['components', 'componentGroups'],
            (treebank, state, details) => {
                const group = details.componentGroups.find(g => g.key === groupKey);
                const groupComponents = Object.values(group.components).filter(id => id !== MISSING_COMPONENT_ID && !details.components[id].disabled);
                selected = selected != null
                    ? selected
                    : !groupComponents.every(id => state.components[id]);
                groupComponents.forEach(id => state.components[id] = selected);

                // keep only the first one in the group
                if (selected && !treebank.multiOption) {
                    groupComponents.slice(1).forEach(id => state.components[id] = false);
                }

                state.selected = Object.values(details.components).some(c => state.components[c.id]);
                return state;
            },
            (details) => !!details.componentGroups.find(g => g.key === groupKey));
    }

    async toggleVariant(provider: string, corpus: string, variant: string, selected?: boolean) {
        this.updateTreebankState(provider, corpus, ['components', 'componentGroups', 'variants'],
            (treebank, state, details) => {
                const variantComponents = details.componentGroups.map(g => g.components[variant])
                    .filter(id => id !== MISSING_COMPONENT_ID && !details.components[id].disabled);
                selected = selected != null
                    ? selected
                    : !variantComponents.every(id => state.components[id]);
                variantComponents.forEach(id => state.components[id] = selected);
                if (selected && !treebank.multiOption) {
                    variantComponents.slice(1).forEach(id => state.components[id] = false);
                }

                state.selected = Object.values(details.components).some(c => state.components[c.id]);
                return state;
            },
            (details) => {
                return details.variants.includes(variant);
            });
    }

    private async updateTreebankState<T extends keyof TreebankDetails>(
        provider: string,
        corpus: string,
        details: T[],
        updateState: (
            treebank: Treebank,
            treebankState: CorpusSelection,
            detailLookup: DetailLookup<T>) => CorpusSelection,
        condition?: (detailLookup: DetailLookup<T>) => boolean) {
        const treebank = await this.treebankService.get(provider, corpus);
        if (!treebank) { return; }

        const detailPromises: Promise<any>[] = details.map(key => treebank.details[key]());
        const resolvedDetails = await Promise.all(detailPromises);
        const detailLookup = details.reduce(
            (prev, curr, index) => ({
                ...prev,
                [curr]: resolvedDetails[index]
            }), {}) as DetailLookup<T>;

        if (condition && !condition(detailLookup)) {
            return;
        }

        this.stateService.updateState(
            (state) => {
                const { selectedTreebanks } = state;
                const updated = selectedTreebanks.clone();
                if (!updated.data[provider]) {
                    updated.data[provider] = {};
                }
                const existing = updated.data[provider][corpus];
                updated.data[provider][corpus] = updateState(
                    treebank,
                    existing
                        ? { components: { ...existing.components }, selected: existing.selected }
                        : { components: {}, selected: false },
                    detailLookup);

                state.selectedTreebanks = updated;
                if (state.currentStep.type === StepType.SelectTreebanks) {
                    state.valid = updated.hasAnySelection();
                }
            });
    }
}
