import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { SentenceCollectionComponent } from './sentence-collection.component';
import { commonTestBed } from '../../../common-test-bed';
import { StateService } from '../../../services/state.service';
import { MweState } from '../../../pages/multi-step-page/steps';

describe('SentenceCollectionComponent', () => {
    let component: SentenceCollectionComponent;
    let fixture: ComponentFixture<SentenceCollectionComponent>;
    let stateService: StateService<MweState>;

    beforeEach(waitForAsync(() => {
        const testBed = commonTestBed();
        stateService = testBed.stateService;
        testBed.testingModule.compileComponents();
    }));

    beforeEach(() => {
        fixture = TestBed.createComponent(SentenceCollectionComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should exclude sentences that do not contain the filter string', async () => {
        component.sentences = [
            { id: 1, text: 'first' },
            { id: 2, text: 'second' },
            { id: 3, text: 'third' },
        ];
        stateService.setState({
            canonicalForm: { text: 'con' }
        });

        const actual = await firstValueFrom(component.filteredSentences$);
        expect(actual).toEqual([{ id: 2, text: 'second' }]);
    });
});
