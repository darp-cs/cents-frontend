import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { EMPTY, catchError, finalize, tap } from 'rxjs';
import { AgentService, AgentTemplateRecord } from '../agent.service';

@Component({
  selector: 'app-agents-page',
  imports: [DatePipe],
  templateUrl: './agents-page.component.html',
  styleUrl: './agents-page.component.css',
})
export class AgentsPageComponent {
  private readonly agentService = inject(AgentService);
  private readonly router = inject(Router);

  readonly agents = signal<AgentTemplateRecord[]>([]);
  readonly versionsByName = signal<Record<string, AgentTemplateRecord[]>>({});
  readonly expandedByName = signal<Record<string, boolean>>({});
  readonly versionLoadingByName = signal<Record<string, boolean>>({});
  readonly versionErrorByName = signal<Record<string, string | null>>({});

  readonly isLoading = signal(false);
  readonly isMutating = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    this.loadAgents();
  }

  navigateToNewAgent() {
    void this.router.navigate(['/agents/new']);
  }

  toggleVersionHistory(name: string) {
    const isExpanded = this.isHistoryExpanded(name);
    this.expandedByName.update((state) => ({ ...state, [name]: !isExpanded }));

    if (!isExpanded && !this.versionsByName()[name]) {
      this.loadVersions(name);
    }
  }

  isHistoryExpanded(name: string) {
    return this.expandedByName()[name] ?? false;
  }

  versionsFor(name: string) {
    return this.versionsByName()[name] ?? [];
  }

  isVersionLoading(name: string) {
    return this.versionLoadingByName()[name] ?? false;
  }

  versionError(name: string) {
    return this.versionErrorByName()[name] ?? null;
  }

  setEnabled(agent: AgentTemplateRecord) {
    if (!agent.is_valid) {
      return;
    }

    this.error.set(null);
    this.isMutating.set(true);

    this.agentService
      .setAgentEnabled(agent.name, { enabled: !agent.enabled, version: agent.version })
      .pipe(
        tap((updated) => {
          this.agents.update((records) =>
            records.map((record) => (record.name === updated.name ? { ...record, enabled: updated.enabled } : record))
          );

          if (this.isHistoryExpanded(agent.name)) {
            this.loadVersions(agent.name);
          }
        }),
        catchError((error) => {
          this.error.set(this.toErrorMessage(error, 'Failed to update enabled state.'));
          return EMPTY;
        }),
        finalize(() => this.isMutating.set(false))
      )
      .subscribe();
  }

  deleteAgent(name: string) {
    const shouldDelete = window.confirm(`Delete agent "${name}" and all of its versions?`);
    if (!shouldDelete) {
      return;
    }

    this.error.set(null);
    this.isMutating.set(true);

    this.agentService
      .deleteAgent(name)
      .pipe(
        tap(() => {
          this.agents.update((records) => records.filter((record) => record.name !== name));
          this.removeAgentState(name);
        }),
        catchError((error) => {
          this.error.set(this.toErrorMessage(error, 'Failed to delete agent.'));
          return EMPTY;
        }),
        finalize(() => this.isMutating.set(false))
      )
      .subscribe();
  }

  private loadAgents() {
    this.error.set(null);
    this.isLoading.set(true);

    this.agentService
      .listAgents()
      .pipe(
        tap((records) => this.agents.set(this.sortByName(records))),
        catchError((error) => {
          this.error.set(this.toErrorMessage(error, 'Failed to load agents.'));
          return EMPTY;
        }),
        finalize(() => this.isLoading.set(false))
      )
      .subscribe();
  }

  private loadVersions(name: string) {
    this.setVersionError(name, null);
    this.setVersionLoading(name, true);

    this.agentService
      .listAgentVersions(name)
      .pipe(
        tap((versions) => {
          this.versionsByName.update((state) => ({
            ...state,
            [name]: versions,
          }));
        }),
        catchError((error) => {
          this.setVersionError(name, this.toErrorMessage(error, 'Failed to load version history.'));
          return EMPTY;
        }),
        finalize(() => this.setVersionLoading(name, false))
      )
      .subscribe();
  }

  private removeAgentState(name: string) {
    this.versionsByName.update((state) => this.withoutKey(state, name));
    this.expandedByName.update((state) => this.withoutKey(state, name));
    this.versionLoadingByName.update((state) => this.withoutKey(state, name));
    this.versionErrorByName.update((state) => this.withoutKey(state, name));
  }

  private setVersionLoading(name: string, isLoading: boolean) {
    this.versionLoadingByName.update((state) => ({ ...state, [name]: isLoading }));
  }

  private setVersionError(name: string, message: string | null) {
    this.versionErrorByName.update((state) => ({ ...state, [name]: message }));
  }

  private withoutKey<T>(state: Record<string, T>, key: string) {
    const next = { ...state };
    delete next[key];
    return next;
  }

  private sortByName(records: AgentTemplateRecord[]) {
    return [...records].sort((left, right) => left.name.localeCompare(right.name));
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
