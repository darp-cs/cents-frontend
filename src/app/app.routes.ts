import { Routes } from '@angular/router';
import { LoginComponent } from './auth/login/login.component';
import { RegisterComponent } from './auth/register/register.component';
import { authGuard } from './auth/auth.guard';
import { ChatPageComponent } from './chat/chat-page/chat-page.component';
import { DocumentsPageComponent } from './documents/documents-page/documents-page.component';

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
		path: 'chat',
		canActivate: [authGuard],
		component: ChatPageComponent,
	},
	{
		path: 'documents',
		canActivate: [authGuard],
		component: DocumentsPageComponent,
	},
	{
		path: '',
		pathMatch: 'full',
		redirectTo: 'chat',
	},
	{
		path: '**',
		redirectTo: 'chat',
	},
];
