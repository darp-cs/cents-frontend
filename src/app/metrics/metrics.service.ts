import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { catchError, finalize, tap, throwError } from 'rxjs';
import { API_BASE_URL } from '../core/api-config';

export interface MetricsNodeSummary {
  node_key: string;
  requests: number;
  average_latency_ms: number;
  p95_latency_ms: number;
  total_tokens: number;
  judge_pass_rate: number;
}

export interface MetricsSummary {
  total_requests: number;
  average_latency_ms: number;
  p95_latency_ms: number;
  total_tokens: number;
  judge_pass_rate: number;
  by_node_key: MetricsNodeSummary[];
}

type MetricsApiSummary = {
  total_requests?: number;
  average_latency_ms?: number;
  avg_latency_ms?: number;
  p95_latency_ms?: number;
  total_tokens?: number;
  judge_pass_rate?: number;
  by_node_key?: MetricsApiNodeSummary[];
  node_breakdown?: MetricsApiNodeSummary[];
};

type MetricsApiNodeSummary = {
  node_key: string;
  requests?: number;
  request_count?: number;
  average_latency_ms?: number;
  avg_latency_ms?: number;
  p95_latency_ms?: number;
  total_tokens?: number;
  judge_pass_rate?: number;
};

@Injectable({ providedIn: 'root' })
export class MetricsService {
  private readonly http = inject(HttpClient);

  readonly summary = signal<MetricsSummary | null>(null);
  readonly isLoading = signal(false);
  readonly error = signal<string | null>(null);

  loadSummary(from?: string, to?: string) {
    this.error.set(null);
    this.isLoading.set(true);

    let params = new HttpParams();
    if (from) {
      params = params.set('from', from);
    }
    if (to) {
      params = params.set('to', to);
    }

    return this.http.get<MetricsApiSummary>(`${API_BASE_URL}/metrics/summary`, { params }).pipe(
      tap((summary) => this.summary.set(this.normalizeSummary(summary))),
      catchError((error) => {
        this.error.set(this.toErrorMessage(error, 'Failed to load metrics.'));
        return throwError(() => error);
      }),
      finalize(() => this.isLoading.set(false))
    );
  }

  private normalizeSummary(summary: MetricsApiSummary): MetricsSummary {
    const nodes = summary.by_node_key ?? summary.node_breakdown ?? [];

    return {
      total_requests: summary.total_requests ?? 0,
      average_latency_ms: summary.average_latency_ms ?? summary.avg_latency_ms ?? 0,
      p95_latency_ms: summary.p95_latency_ms ?? 0,
      total_tokens: summary.total_tokens ?? 0,
      judge_pass_rate: summary.judge_pass_rate ?? 0,
      by_node_key: nodes.map((node) => ({
        node_key: node.node_key,
        requests: node.requests ?? node.request_count ?? 0,
        average_latency_ms: node.average_latency_ms ?? node.avg_latency_ms ?? 0,
        p95_latency_ms: node.p95_latency_ms ?? 0,
        total_tokens: node.total_tokens ?? 0,
        judge_pass_rate: node.judge_pass_rate ?? 0,
      })),
    };
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
