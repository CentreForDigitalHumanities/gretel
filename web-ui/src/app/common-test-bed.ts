import { APP_BASE_HREF } from '@angular/common';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';

import { ClipboardModule, ClipboardService } from 'ngx-clipboard';

import { declarations, imports, providers } from './app.module';
import { AppRoutingModule } from './app-routing/app-routing.module';
import { routes } from './app-routing/routes';

import { ClipboardServiceMock } from './mocks/clipboard.service.mock';
import { HttpClientMock } from './mocks/http-client.mock';

import {
    ConfigurationService,
    UploadedTreebankResponse,
    ConfiguredTreebanksResponse,
    StateService,
    TreebankService,
    NotificationService
} from './services/_index';
import { ConfigurationServiceMock } from './services/configuration.service.mock';
import { GlobalState } from './pages/multi-step-page/steps';
import { TreebankSelection } from './treebank';

export function commonTestBed() {
    const httpClientMock = new HttpClientMock();
    const stateService = new StateService<any>();
    stateService.init({}, []);

    const filteredImports = imports.filter(value => !(value in [AppRoutingModule, ClipboardModule, HttpClientModule]));
    filteredImports.push(
        RouterTestingModule.withRoutes(routes));

    const filteredProviders = providers.filter(provider => provider !== ConfigurationService);
    filteredProviders.push(
        {
            provide: APP_BASE_HREF,
            useValue: '/'
        }, {
            provide: ClipboardService,
            useClass: ClipboardServiceMock
        }, {
            provide: ConfigurationService,
            useValue: new ConfigurationServiceMock()
        }, {
            provide: HttpClient,
            useValue: httpClientMock
        }, {
            provide: StateService,
            useValue: stateService
        }, {
            provide: Title,
            useClass: Title
        });

    // common mock data
    httpClientMock.setData('get', '/gretel-upload/index.php/api/treebank', [] as UploadedTreebankResponse[]);

    httpClientMock.setData('get', '/gretel/api/src/router.php/configured_treebanks', {
        'test-treebank': {
            title: 'test title',
            metadata: [],
            description: 'test treebank',
            variants: {
                'v1': { display: 'v1' },
                'v2': { display: 'v2' }
            },
            groups: {
                'test-group': {
                    description: 'test group description'
                }
            },
            components: {
                'test-component1': {
                    description: '',
                    // Omitted on purpose
                    // disabled: false,
                    group: 'test-group',
                    id: 'test-component1',
                    sentences: 10,
                    words: 100,
                    title: '',
                    variant: 'v1',
                },
                'test-component2': {
                    id: 'test-component2',
                    title: '',
                    description: '',
                    sentences: 20,
                    words: 200,
                    group: 'test-group',
                    variant: 'v2',
                    disabled: true
                }
            }
        }
    } as ConfiguredTreebanksResponse);

    httpClientMock.setData('post', '/gretel/api/src/router.php/treebank_counts', (body: any) => {
        return { 'TEST_DATABASE1_COMPONENT1': '42' };
    });

    httpClientMock.setData('post', '/gretel/api/src/router.php/results', (body: any) => {
        return false;
    });

    return {
        testingModule: TestBed.configureTestingModule({
            declarations,
            imports: filteredImports,
            providers: [...filteredProviders, NotificationService]
        }),
        httpClientMock,
        stateService
    };
}

export function initStateService() {
    const stateService = TestBed.get(StateService) as StateService<GlobalState>;
    stateService.init({
        connectionError: false,
        currentStep: undefined,
        filterValues: {},
        retrieveContext: false,
        selectedTreebanks: new TreebankSelection(TestBed.get(TreebankService)),
        variableProperties: [],
        xpath: `//node[@cat="smain"
and node[@rel="su" and @pt="vnw"]
and node[@rel="hd" and @pt="ww"]
and node[@rel="predc" and @cat="np"
    and node[@rel="det" and @pt="lid"]
    and node[@rel="hd" and @pt="n"]]]`,
        valid: true,
        loading: false
    }, []);
}
