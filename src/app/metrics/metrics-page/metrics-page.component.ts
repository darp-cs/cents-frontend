import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MetricsService } from '../metrics.service';

@Component({
  selector: 'app-metrics-page',
  imports: [FormsModule],
  templateUrl: './metrics-page.component.html',
  styleUrl: './metrics-page.component.css',
})
export class MetricsPageComponent {
  private readonly metricsService = inject(MetricsService);

  readonly summary = this.metricsService.summary;
  readonly isLoading = this.metricsService.isLoading;
  readonly error = this.metricsService.error;
  from = this.toDateInputValue(new Date(Date.now() - 24 * 60 * 60 * 1000));
  to = this.toDateInputValue(new Date());

  constructor() {
    this.refresh();
  }

  refresh() {
    this.metricsService.loadSummary(this.from, this.to).subscribe({ error: () => undefined });
  }

  formatNumber(value: number) {
    return new Intl.NumberFormat().format(value);
  }

  formatLatency(value: number) {
    return `${Math.round(value)} ms`;
  }

  formatRate(value: number) {
    return `${Math.round(value * 100)}%`;
  }

  barWidth(requests: number) {
    const nodes = this.summary()?.by_node_key ?? [];
    const maximum = Math.max(...nodes.map((node) => node.requests), 1);
    return `${Math.max((requests / maximum) * 100, requests > 0 ? 4 : 0)}%`;
  }

  private toDateInputValue(date: Date) {
    return date.toISOString().slice(0, 10);
  }
}
