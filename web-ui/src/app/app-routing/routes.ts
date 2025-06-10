/**
 * All the routes of the main pages
 */

import { Routes } from '@angular/router';

import { AboutPageComponent } from '../pages/about-page/about-page.component';
import { HomePageComponent } from '../pages/home-page/home-page.component';
import { DocumentationComponent } from '../pages/documentation/documentation.component';
import { XpathSearchComponent } from '../pages/xpath-search/xpath-search.component';
import { MultiWordExpressionsComponent } from '../pages/multi-word-expressions/multi-word-expressions.component';
import { ExampleBasedSearchComponent } from '../pages/example-based-search/example-based-search.component';
import { ExternalTreeVisualizerComponent } from '../components/tree-visualizer/external-tree-visualizer.component';
import { LegacyComponent } from '../pages/legacy-component';


const routes: Routes = [
    {
        path: 'home',
        component: HomePageComponent,
    },
    {
        path: 'example-based-search',
        component: ExampleBasedSearchComponent,
    },
    {
        path: 'xpath-search',
        component: XpathSearchComponent,
    },
    {
        path: 'mwe-search',
        component: MultiWordExpressionsComponent,
    },
    {
        path: 'about',
        component: AboutPageComponent,
    },
    {
        path: 'documentation',
        component: DocumentationComponent,
    },
    {
        path: 'tree',
        component: ExternalTreeVisualizerComponent,
    },
    {
        path: '',
        redirectTo: '/home',
        pathMatch: 'full'
    },
    {
        path: '**',
        component: LegacyComponent
    }
];

export { routes };
