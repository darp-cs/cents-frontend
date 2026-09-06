import { Routes } from '@angular/router';
import { LoginComponent } from './auth/login/login.component';
import { RegisterComponent } from './auth/register/register.component';
import { authGuard } from './auth/auth.guard';
import { DocumentsPageComponent } from './documents/documents-page/documents-page.component';
import { GuidePageComponent } from './guide/guide-page/guide-page.component';

export const routes: Routes = [
	{
		path: 'login',
		component: LoginComponent,
	},
	{
		path: 'register',
		component: RegisterComponent,
	},
	{
		path: 'guide',
		canActivate: [authGuard],
		component: GuidePageComponent,
	},
	{
		path: 'documents',
		canActivate: [authGuard],
		component: DocumentsPageComponent,
	},
	{
		path: 'tools',
		canActivate: [authGuard],
		loadComponent: () => import('./shell/placeholder-page/placeholder-page.component').then((module) => module.PlaceholderPageComponent),
		data: {
			title: 'Tools',
			description: 'Manage the tools your assistant can call during a conversation.',
		},
	},
	{
		path: 'agents',
		canActivate: [authGuard],
		loadComponent: () => import('./shell/placeholder-page/placeholder-page.component').then((module) => module.PlaceholderPageComponent),
		data: {
			title: 'Agents',
			description: 'Create and configure agents that combine models, tools and instructions.',
		},
	},
	{
		path: 'knowledge-base',
		canActivate: [authGuard],
		loadComponent: () => import('./shell/placeholder-page/placeholder-page.component').then((module) => module.PlaceholderPageComponent),
		data: {
			title: 'Knowledge Base',
			description: 'Organise the indexed content your assistant retrieves answers from.',
		},
	},
	{
		path: 'configuration',
		canActivate: [authGuard],
		loadComponent: () => import('./shell/placeholder-page/placeholder-page.component').then((module) => module.PlaceholderPageComponent),
		data: {
			title: 'Configuration',
			description: 'Adjust workspace level settings, models and integrations.',
		},
	},
	{
		path: 'metrics',
		canActivate: [authGuard],
		loadComponent: () => import('./shell/placeholder-page/placeholder-page.component').then((module) => module.PlaceholderPageComponent),
		data: {
			title: 'Metrics',
			description: 'Review usage, performance and activity across your workspace.',
		},
	},
	{
		path: '',
		pathMatch: 'full',
		redirectTo: 'guide',
	},
	{
		path: '**',
		redirectTo: 'guide',
	},
];
