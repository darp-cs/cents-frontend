import { computed, inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, finalize, of, switchMap, tap, throwError } from 'rxjs';
import { API_BASE_URL } from '../core/api-config';

export interface Conversation {
  id: string;
  title: string;
  updated_at: string;
}

@Injectable({ providedIn: 'root' })
export class ConversationService {
  private readonly http = inject(HttpClient);

  private readonly conversationsSignal = signal<Conversation[]>([]);
  private readonly activeConversationIdSignal = signal<string | null>(null);

  readonly conversations = this.conversationsSignal.asReadonly();
  readonly activeConversationId = this.activeConversationIdSignal.asReadonly();
  readonly activeConversation = computed(() =>
    this.conversationsSignal().find((conversation) => conversation.id === this.activeConversationIdSignal()) ?? null
  );

  readonly isLoading = signal(false);
  readonly isMutating = signal(false);
  readonly error = signal<string | null>(null);

  loadConversations() {
    this.error.set(null);
    this.isLoading.set(true);

    return this.http.get<Conversation[]>(`${API_BASE_URL}/conversations`).pipe(
      tap((conversations) => {
        this.conversationsSignal.set(this.sortByUpdatedAt(conversations));
        if (!this.activeConversationIdSignal() && conversations.length > 0) {
          this.activeConversationIdSignal.set(conversations[0].id);
        }
      }),
      catchError((error) => {
        this.error.set(this.toErrorMessage(error, 'Failed to load conversations.'));
        return throwError(() => error);
      }),
      finalize(() => this.isLoading.set(false))
    );
  }

  createConversation(title: string) {
    this.error.set(null);
    this.isMutating.set(true);

    return this.http.post<Conversation>(`${API_BASE_URL}/conversations`, { title }).pipe(
      tap((conversation) => {
        this.conversationsSignal.set(this.sortByUpdatedAt([conversation, ...this.conversationsSignal()]));
        this.activeConversationIdSignal.set(conversation.id);
      }),
      catchError((error) => {
        this.error.set(this.toErrorMessage(error, 'Failed to create conversation.'));
        return throwError(() => error);
      }),
      finalize(() => this.isMutating.set(false))
    );
  }

  renameConversation(conversationId: string, title: string) {
    this.error.set(null);
    this.isMutating.set(true);

    return this.http.patch<Conversation>(`${API_BASE_URL}/conversations/${conversationId}`, { title }).pipe(
      tap((updatedConversation) => {
        const next = this.conversationsSignal().map((conversation) =>
          conversation.id === conversationId ? updatedConversation : conversation
        );
        this.conversationsSignal.set(this.sortByUpdatedAt(next));
      }),
      catchError((error) => {
        this.error.set(this.toErrorMessage(error, 'Failed to rename conversation.'));
        return throwError(() => error);
      }),
      finalize(() => this.isMutating.set(false))
    );
  }

  deleteConversation(conversationId: string) {
    this.error.set(null);
    this.isMutating.set(true);

    return this.http.delete<void>(`${API_BASE_URL}/conversations/${conversationId}`).pipe(
      tap(() => {
        const remaining = this.conversationsSignal().filter((conversation) => conversation.id !== conversationId);
        this.conversationsSignal.set(this.sortByUpdatedAt(remaining));

        if (this.activeConversationIdSignal() === conversationId) {
          this.activeConversationIdSignal.set(remaining[0]?.id ?? null);
        }
      }),
      catchError((error) => {
        this.error.set(this.toErrorMessage(error, 'Failed to delete conversation.'));
        return throwError(() => error);
      }),
      finalize(() => this.isMutating.set(false))
    );
  }

  setActiveConversation(conversationId: string) {
    this.activeConversationIdSignal.set(conversationId);
  }

  ensureConversationLoaded() {
    const currentConversations = this.conversationsSignal();
    if (currentConversations.length > 0) {
      if (!this.activeConversationIdSignal()) {
        this.activeConversationIdSignal.set(currentConversations[0].id);
      }
      return of(currentConversations);
    }

    return this.loadConversations().pipe(
      switchMap((conversations) => {
        if (conversations.length > 0) {
          return of(conversations);
        }

        return this.createConversation('New conversation').pipe(
          switchMap(() => of(this.conversationsSignal()))
        );
      })
    );
  }

  private sortByUpdatedAt(conversations: Conversation[]) {
    return [...conversations].sort((a, b) => {
      const left = new Date(a.updated_at).getTime();
      const right = new Date(b.updated_at).getTime();
      return right - left;
    });
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
