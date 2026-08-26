import { computed, inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, finalize, firstValueFrom, map, of, tap, throwError } from 'rxjs';
import { API_BASE_URL } from '../core/api-config';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

interface AuthResponse {
  token: string;
  user: AuthUser;
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

    return this.http.post<AuthResponse>(`${API_BASE_URL}/auth/login`, payload).pipe(
      tap((response) => this.setSession(response)),
      map((response) => response.user),
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

    return this.http.post<AuthResponse>(`${API_BASE_URL}/auth/register`, payload).pipe(
      tap((response) => this.setSession(response)),
      map((response) => response.user),
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

    return firstValueFrom(
      this.http.get<AuthResponse>(`${API_BASE_URL}/auth/session`, { withCredentials: true }).pipe(
        tap((response) => this.setSession(response)),
        map(() => undefined),
        catchError(() => {
          this.clearSession();
          return of(undefined);
        }),
        finalize(() => this.isCheckingSession.set(false))
      )
    );
  }

  private setSession(response: AuthResponse) {
    this.tokenSignal.set(response.token);
    this.userSignal.set(response.user);
  }

  private clearSession() {
    this.tokenSignal.set(null);
    this.userSignal.set(null);
  }

  private toErrorMessage(error: unknown, fallback: string) {
    if (typeof error === 'object' && error !== null && 'error' in error) {
      const payload = (error as { error?: { message?: string } }).error;
      if (payload?.message) {
        return payload.message;
      }
    }

    return fallback;
  }
}
