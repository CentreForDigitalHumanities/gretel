import { Component, Input, OnChanges, SimpleChanges, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';

import { animations } from '../../../animations';
import { MISSING_COMPONENT_ID, TreebankSelectionService } from '../../../services/_index';
import { TreebankComponent, ComponentGroup, FuzzyNumber, Treebank, TreebankComponents, TreebankSelection } from '../../../treebank';

interface VariantSelection {
    name: string;
    selected: boolean;
}

interface ComponentSelection {
    [id: string]: TreebankComponent & { selected: boolean };
}

@Component({
    animations,
    selector: 'grt-sub-treebanks',
    templateUrl: './sub-treebanks.component.html',
    styleUrls: ['./sub-treebanks.component.scss']
})
export class SubTreebanksComponent implements OnChanges, OnDestroy {
    private selection: TreebankSelection;
    private subscriptions: Subscription[];

    public components: ComponentSelection;
    public componentGroups: ComponentGroup[];
    public variants: VariantSelection[];

    public allSelected = true;

    public loading = true;

    /** Only show if any sub-treebank has a description available. */
    public showDescription: boolean;
    public showWordCount: boolean;
    public totalSentenceCount: string;
    public totalWordCount: string;
    public totalSentenceCountByGroup: { [group: string]: string };
    public totalWordCountByGroup: { [group: string]: string };
    public totalSentenceCountByVariant: { [variant: string]: string };
    public totalWordCountByVariant: { [variant: string]: string };

    @Input() treebank: Treebank;

    constructor(private treebankSelectionService: TreebankSelectionService) {
        this.subscriptions = [this.treebankSelectionService.state$.subscribe(selection => {
            this.selection = selection;
            this.updateSelections(
                this.components,
                this.variants && this.variants.map(v => v.name));
        })];
    }

    ngOnDestroy() {
        this.subscriptions.forEach(s => s.unsubscribe());
    }

    async ngOnChanges(changes: SimpleChanges) {
        if (changes['treebank']) {
            this.loading = true;
            const details = this.treebank.details;
            const [components, componentGroups, variants] = await Promise.all([
                details.components(),
                details.componentGroups(),
                details.variants()]);

            this.componentGroups = componentGroups;

            this.updateSelections(components, variants);

            this.showDescription = Object.values(components).some(c => !!c.description);
            await this.updateTotals();
            this.loading = false;
        }
    }

    isTreebankSelected() {
        return this.selection.isSelected(this.treebank.provider, this.treebank.id);
    }

    private isComponentSelectedOrDisabled(component: TreebankComponent) {
        return component.disabled ||
            this.selection.isSelected(this.treebank.provider, this.treebank.id, component.id);
    }

    toggleVariant(variant?: string) {
        if (variant) {
            this.treebankSelectionService.toggleVariant(this.treebank.provider, this.treebank.id, variant);
        } else {
            this.treebankSelectionService.toggleComponents(this.treebank.provider, this.treebank.id);
        }

        if (!this.treebank.multiOption) {
            return;
        }
    }

    toggleComponent(component: TreebankComponent) {
        this.treebankSelectionService.toggleComponent(
            this.treebank.provider,
            this.treebank.id,
            component.id
        );
    }

    toggleGroup(group: ComponentGroup) {
        if (!this.treebank.multiOption && (this.variants && this.variants.length > 1)) {
            return;
        }

        this.treebankSelectionService.toggleComponentGroup(
            this.treebank.provider,
            this.treebank.id,
            group.key
        );
    }

    private updateSelections(components: TreebankComponents, variants?: string[]) {
        this.components = Object.entries(components || {}).reduce(
            (dict, [id, component]) => {
                const selected = this.selection.isSelected(
                    this.treebank.provider,
                    this.treebank.id,
                    id);
                dict[id] = { ...component, selected };
                return dict;
            },
            {} as ComponentSelection);

        if (this.componentGroups?.length > 1 && variants?.length > 1) {
            // maybe a component is missing?
            this.components[MISSING_COMPONENT_ID] = {
                description: '',
                id: MISSING_COMPONENT_ID,
                selected: false,
                sentenceCount: '?',
                title: '—',
                wordCount: '?',
                disabled: true
            }
        }
        else {
            delete this.components[MISSING_COMPONENT_ID];
        }

        this.variants = variants && variants.map(variant => ({
            name: variant,
            selected: this.componentGroups
                .map(g => this.components[g.components[variant]])
                .every(component => this.isComponentSelectedOrDisabled(component))
        }));
        if (this.components) {
            this.allSelected = Object.values(this.components).every(component => this.isComponentSelectedOrDisabled(component));
        }
    }

    private updateTotals() {
        interface FuzzyCounts { [group: string]: FuzzyNumber; }
        const totalSentenceCount = new FuzzyNumber(0);
        const totalWordCount = new FuzzyNumber(0);
        const totalSentenceCountByGroup: FuzzyCounts = {};
        const totalWordCountByGroup: FuzzyCounts = {};
        const totalSentenceCountByVariant: FuzzyCounts = {};
        const totalWordCountByVariant: FuzzyCounts = {};

        if (this.variants && this.componentGroups) {
            for (const group of this.componentGroups) {
                totalSentenceCountByGroup[group.key] = new FuzzyNumber(0);
                totalWordCountByGroup[group.key] = new FuzzyNumber(0);
            }
            for (const variant of this.variants) {
                totalSentenceCountByVariant[variant.name] = new FuzzyNumber(0);
                totalWordCountByVariant[variant.name] = new FuzzyNumber(0);
            }
        }
        for (const subTreebank of Object.values(this.components).filter(s => !s.disabled)) {
            totalSentenceCount.add(subTreebank.sentenceCount);
            totalWordCount.add(subTreebank.wordCount);

            if (this.variants && this.componentGroups) {
                totalSentenceCountByGroup[subTreebank.group].add(subTreebank.sentenceCount);
                totalSentenceCountByVariant[subTreebank.variant].add(subTreebank.sentenceCount);

                totalWordCountByGroup[subTreebank.group].add(subTreebank.wordCount);
                totalWordCountByVariant[subTreebank.variant].add(subTreebank.wordCount);
            }
        }

        this.totalSentenceCount = totalSentenceCount.toLocaleString();
        this.totalWordCount = totalWordCount.toLocaleString();
        this.showWordCount = !totalWordCount.unknown || totalWordCount.value > 0;

        function mapFuzzyCounts(counts: FuzzyCounts) {
            const result: { [key: string]: string } = {};
            for (const key of Object.keys(counts)) {
                result[key] = counts[key].toLocaleString();
            }
            return result;
        }

        this.totalSentenceCountByGroup = mapFuzzyCounts(totalSentenceCountByGroup);
        this.totalWordCountByGroup = mapFuzzyCounts(totalWordCountByGroup);
        this.totalSentenceCountByVariant = mapFuzzyCounts(totalSentenceCountByVariant);
        this.totalWordCountByVariant = mapFuzzyCounts(totalWordCountByVariant);
    }
}
