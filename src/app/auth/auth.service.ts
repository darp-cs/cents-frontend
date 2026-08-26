import { computed, inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, finalize, firstValueFrom, map, of, switchMap, tap, throwError } from 'rxjs';
import { API_BASE_URL } from '../core/api-config';

export interface AuthUser {
  id: string;
  email: string;
  is_active: boolean;
  is_superuser: boolean;
  is_verified: boolean;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
}

interface LoginPayload {
  email: string;
  password: string;
}

interface RegisterPayload extends LoginPayload {
  name: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly tokenSignal = signal<string | null>(null);
  private readonly userSignal = signal<AuthUser | null>(null);

  readonly currentUser = this.userSignal.asReadonly();
  readonly isAuthenticated = computed(() => this.tokenSignal() !== null);

  readonly isCheckingSession = signal(false);
  readonly isSubmitting = signal(false);
  readonly authError = signal<string | null>(null);

  getToken(): string | null {
    return this.tokenSignal();
  }

  login(payload: LoginPayload) {
    this.authError.set(null);
    this.isSubmitting.set(true);

    return this.loginWithPassword(payload).pipe(
      catchError((error) => {
        this.authError.set(this.toErrorMessage(error, 'Login failed.'));
        return throwError(() => error);
      }),
      finalize(() => this.isSubmitting.set(false))
    );
  }

  register(payload: RegisterPayload) {
    this.authError.set(null);
    this.isSubmitting.set(true);

    return this.http
      .post<AuthUser>(`${API_BASE_URL}/auth/register`, {
        email: payload.email,
        password: payload.password,
      })
      .pipe(
        switchMap(() => this.loginWithPassword({ email: payload.email, password: payload.password })),
        catchError((error) => {
          this.authError.set(this.toErrorMessage(error, 'Registration failed.'));
          return throwError(() => error);
        }),
        finalize(() => this.isSubmitting.set(false))
      );
  }

  logout() {
    this.clearSession();
    this.router.navigate(['/login']);
  }

  handleUnauthorized() {
    this.clearSession();
    this.router.navigate(['/login']);
  }

  silentCheck() {
    this.isCheckingSession.set(true);

    const token = this.tokenSignal();
    if (!token) {
      this.isCheckingSession.set(false);
      return Promise.resolve(undefined);
    }

    return firstValueFrom(
      this.http.get<AuthUser>(`${API_BASE_URL}/users/me`).pipe(
        tap((user) => this.userSignal.set(user)),
        map(() => undefined),
        catchError(() => {
          this.clearSession();
          return of(undefined);
        }),
        finalize(() => this.isCheckingSession.set(false))
      )
    );
  }

  private loginWithPassword(payload: LoginPayload) {
    const formBody = new URLSearchParams();
    formBody.set('username', payload.email);
    formBody.set('password', payload.password);

    return this.http
      .post<TokenResponse>(`${API_BASE_URL}/auth/jwt/login`, formBody.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })
      .pipe(
        tap((response) => this.tokenSignal.set(response.access_token)),
        switchMap(() => this.http.get<AuthUser>(`${API_BASE_URL}/users/me`)),
        tap((user) => this.userSignal.set(user))
      );
  }

  private clearSession() {
    this.tokenSignal.set(null);
    this.userSignal.set(null);
  }

  private toErrorMessage(error: unknown, fallback: string) {
    if (typeof error === 'object' && error !== null && 'error' in error) {
      const payload = (error as { error?: { message?: string; detail?: string } }).error;
      if (payload?.message) {
        return payload.message;
      }

      if (payload?.detail) {
        return payload.detail;
      }
    }

    return fallback;
  }
}
