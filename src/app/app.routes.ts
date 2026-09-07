import { Routes } from '@angular/router';
import { LoginComponent } from './auth/login/login.component';
import { RegisterComponent } from './auth/register/register.component';
import { authGuard } from './auth/auth.guard';
import { AgentsPageComponent } from './agents/agents-page/agents-page.component';
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
		loadComponent: () => import('./tools/tools-page/tools-page.component').then((module) => module.ToolsPageComponent),
	},
	{
		path: 'agents/new',
		canActivate: [authGuard],
		loadComponent: () =>
			import('./agents/agent-template-editor/agent-template-editor.component').then(
				(module) => module.AgentTemplateEditorComponent
			),
	},
	{
		path: 'agents/:name/edit',
		canActivate: [authGuard],
		loadComponent: () =>
			import('./agents/agent-template-editor/agent-template-editor.component').then(
				(module) => module.AgentTemplateEditorComponent
			),
	},
	{
		path: 'agents',
		canActivate: [authGuard],
		component: AgentsPageComponent,
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
