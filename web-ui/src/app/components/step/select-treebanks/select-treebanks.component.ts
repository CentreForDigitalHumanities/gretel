import { Component, OnInit, OnDestroy, Output, EventEmitter } from '@angular/core';
import { faChevronLeft, faChevronRight, faLock, faTags } from '@fortawesome/free-solid-svg-icons';

import { map } from 'rxjs/operators';
import { Subscription } from 'rxjs';

import { animations } from '../../../animations';
import { GlobalStateExampleBased, StepType } from '../../../pages/multi-step-page/steps';
import { Treebank, TreebankSelection } from '../../../treebank';
import { StateService, TreebankService, TreebankSelectionService, NotificationService } from '../../../services/_index';
import { StepDirective } from '../step.directive';
import { UserProvider } from './select-treebank-providers.component';
import { comparatorGenerator } from '../../util';

// bulma.io tag colors
const colors = [
    'primary',
    'link',
    'info',
    'success',
    'warning',
    'danger'
];

@Component({
    animations,
    selector: 'grt-select-treebanks',
    templateUrl: './select-treebanks.component.html',
    styleUrls: ['./select-treebanks.component.scss']
})
export class SelectTreebanksComponent extends StepDirective<GlobalStateExampleBased> implements OnInit, OnDestroy {
    faChevronLeft = faChevronLeft;
    faChevronRight = faChevronRight;
    faLock = faLock;
    faTags = faTags;

    public treebanks: (Treebank & {
        color: string,
        userName: string,
        preConfigured: boolean,
        selected: boolean,
        /**
         * Don't automatically hide its subtreebank when it has been manually opened
         */
        opened: boolean
    })[] = [];
    public loading = true;
    public stepType = StepType.SelectTreebanks;
    public selection: TreebankSelection;
    public userProviders: UserProvider[];
    public filterText = '';

    public showPreConfigured = true;
    public showUserTags = false;
    public showUsers: number[] = [];

    @Output()
    public prev = new EventEmitter();

    @Output()
    public next = new EventEmitter();

    private readonly subscriptions: Subscription[];
    private userColors: { [userId: number]: string } = {};
    private userNames: { [userId: number]: string } = {};
    private colorIndex = 0;

    constructor(treebankService: TreebankService,
        private treebankSelectionService: TreebankSelectionService,
        stateService: StateService<GlobalStateExampleBased>,
        notificationService: NotificationService) {
        super(stateService, notificationService);

        this.subscriptions = [
            treebankService.treebanks.pipe(
                map(lookup => Object.values(lookup.data).flatMap(provider => Object.values(provider))))
                .subscribe(treebanks => {
                    this.treebanks = treebanks.map(treebank => {
                        const selected = this.selection && this.selection.isSelected(treebank.provider, treebank.id);
                        const existing = this.treebanks.find(t => t.id === treebank.id);
                        return {
                            ...treebank,
                            ...{
                                color: this.determineUserColor(treebank.userId),
                                userName: this.determineUserName(treebank.email, treebank.userId),
                                preConfigured: (treebank.userId ?? null) == null
                            },
                            selected,
                            opened: existing?.opened || selected
                        }
                    }).sort((a, b) => comparatorGenerator(
                        a,
                        b,
                        value => value.displayName.toUpperCase(),
                        value => value.uploaded));

                    this.userProviders = Object.entries(this.userNames).map(
                        ([id, name]) => {
                            let color = this.userColors[id];
                            return {
                                id: +id,
                                color,
                                name
                            }
                        }
                    ).sort((a, b) => comparatorGenerator(a, b, value => value.name.toUpperCase()));

                    this.showUsers = this.userProviders.map(user => user.id);
                }),
            treebankSelectionService.state$.subscribe(selection => {
                this.selection = selection;
                this.treebanks = this.treebanks.map(treebank => {
                    treebank.selected = selection.isSelected(treebank.provider, treebank.id);
                    if (treebank.selected) {
                        treebank.opened = true;
                    }
                    return treebank;
                });
            })
        ];

        // this way treebanks are already shown once they have partially loaded
        treebankService.getTreebanks().then(() => this.loading = false);
    }

    ngOnInit() {
        super.ngOnInit();
    }

    ngOnDestroy() {
        super.ngOnDestroy();
        this.subscriptions.forEach(s => s.unsubscribe());
    }

    toggleTreebank(provider: string, corpus: string) {
        const existing = this.treebanks.find(t => t.id === corpus);
        if (existing.selected) {
            // manually closed it
            existing.opened = false;
        }

        this.treebankSelectionService.toggleCorpus(provider, corpus);
    }

    public getWarningMessage() {
        return 'Please select a treebank and the components.';
    }

    private determineUserColor(userId?: number): string {
        if (userId == undefined || userId == null) {
            return null;
        }

        let color = this.userColors[userId];
        if (color) {
            return color;
        }

        color = this.userColors[userId] = colors[this.colorIndex];
        this.colorIndex = (this.colorIndex + 1) % colors.length;

        return color;
    }

    private determineUserName(email?: string, userId?: number): string {
        if (userId == undefined || userId == null) {
            return null;
        }

        let userName = this.userNames[userId];
        if (userName) {
            return userName;
        }

        const parts = email.split('@')[0].split('.');
        userName = '';
        for (let part of parts) {
            if (part.length === 1) {
                userName += part.toUpperCase();
            } else {
                userName += ' ' + part[0].toUpperCase() + part.substr(1);
            }
        }

        userName = userName.trim();

        this.userNames[userId] = userName;

        return userName;
    }
}
