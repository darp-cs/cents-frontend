import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EMPTY, catchError, finalize, tap } from 'rxjs';
import {
  ToolCodeTestRunPayload,
  ToolCodeTestRunResponse,
  ToolCreatePayload,
  ToolRecord,
  ToolService,
  ToolUpdatePayload,
} from '../tool.service';

type ToolFilter = 'all' | 'enabled' | 'disabled';

@Component({
  selector: 'app-tools-page',
  imports: [FormsModule],
  templateUrl: './tools-page.component.html',
  styleUrl: './tools-page.component.css',
})
export class ToolsPageComponent {
  private readonly toolService = inject(ToolService);

  readonly tools = signal<ToolRecord[]>([]);
  readonly filter = signal<ToolFilter>('all');

  readonly editingToolId = signal<string | null>(null);
  readonly draftName = signal('');
  readonly draftDescription = signal('');
  readonly draftEnabled = signal(true);
  readonly draftPythonCode = signal('');
  readonly draftPythonEntrypoint = signal('run');

  readonly sampleInputJson = signal('{\n  "example": true\n}');
  readonly sampleContextJson = signal('{\n  "location": "tools-page"\n}');
  readonly testRunOutput = signal<ToolCodeTestRunResponse | null>(null);
  readonly testRunError = signal<string | null>(null);
  readonly isTesting = signal(false);

  readonly isLoading = signal(false);
  readonly isMutating = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    this.loadTools();
  }

  setFilter(nextFilter: ToolFilter) {
    if (this.filter() === nextFilter) {
      return;
    }

    this.filter.set(nextFilter);
    this.loadTools();
  }

  startCreate() {
    this.editingToolId.set(null);
    this.draftName.set('');
    this.draftDescription.set('');
    this.draftEnabled.set(true);
    this.draftPythonCode.set('');
    this.draftPythonEntrypoint.set('run');
    this.sampleInputJson.set('{\n  "example": true\n}');
    this.sampleContextJson.set('{\n  "location": "tools-page"\n}');
    this.testRunOutput.set(null);
    this.testRunError.set(null);
    this.error.set(null);
  }

  startEdit(tool: ToolRecord) {
    this.editingToolId.set(tool.id);
    this.draftName.set(tool.name);
    this.draftDescription.set(tool.description);
    this.draftEnabled.set(tool.enabled);
    this.draftPythonCode.set(tool.python_code ?? '');
    this.draftPythonEntrypoint.set(tool.python_entrypoint || 'run');
    this.testRunOutput.set(null);
    this.testRunError.set(null);
    this.error.set(null);
  }

  cancelEdit() {
    this.startCreate();
  }

  saveTool() {
    const name = this.draftName().trim();
    const description = this.draftDescription().trim();
    const pythonCode = this.normalizeCode(this.draftPythonCode());
    const pythonEntrypoint = this.draftPythonEntrypoint().trim() || 'run';

    if (!name || !description) {
      this.error.set('Name and description are required.');
      return;
    }

    this.error.set(null);
    this.isMutating.set(true);

    const editingToolId = this.editingToolId();
    const updatePayload: ToolUpdatePayload = {
      name,
      description,
      enabled: this.draftEnabled(),
      python_code: pythonCode,
      python_entrypoint: pythonEntrypoint,
    };

    const request$ = editingToolId
      ? this.toolService.updateTool(editingToolId, updatePayload)
      : this.toolService.createTool({
          name,
          description,
          enabled: this.draftEnabled(),
          python_code: pythonCode,
          python_entrypoint: pythonEntrypoint,
        } satisfies ToolCreatePayload);

    request$
      .pipe(
        tap(() => {
          this.startCreate();
          this.loadTools();
        }),
        catchError((error) => {
          this.error.set(this.toErrorMessage(error, 'Failed to save tool.'));
          return EMPTY;
        }),
        finalize(() => this.isMutating.set(false))
      )
      .subscribe();
  }

  testRunCode() {
    const pythonCode = this.normalizeCode(this.draftPythonCode());
    if (!pythonCode) {
      this.testRunError.set('Python code is required for test run.');
      this.testRunOutput.set(null);
      return;
    }

    const sampleInput = this.parseJsonObject(this.sampleInputJson(), 'Sample input JSON must be an object.');
    if (!sampleInput) {
      return;
    }

    const sampleContext = this.parseJsonObject(this.sampleContextJson(), 'Sample context JSON must be an object.');
    if (!sampleContext) {
      return;
    }

    this.testRunError.set(null);
    this.testRunOutput.set(null);
    this.error.set(null);
    this.isTesting.set(true);

    const payload: ToolCodeTestRunPayload = {
      python_code: pythonCode,
      python_entrypoint: this.draftPythonEntrypoint().trim() || 'run',
      sample_input: sampleInput,
      sample_context: sampleContext,
      execute: true,
    };

    this.toolService
      .testToolCode(payload)
      .pipe(
        tap((response) => {
          this.testRunOutput.set(response);
        }),
        catchError((error) => {
          this.testRunError.set(this.toErrorMessage(error, 'Failed to test-run Python code.'));
          return EMPTY;
        }),
        finalize(() => this.isTesting.set(false))
      )
      .subscribe();
  }

  toggleEnabled(tool: ToolRecord) {
    this.error.set(null);
    this.isMutating.set(true);

    this.toolService
      .setToolEnabled(tool.id, !tool.enabled)
      .pipe(
        tap((updated) => {
          this.tools.update((records) => records.map((record) => (record.id === updated.id ? updated : record)));
        }),
        catchError((error) => {
          this.error.set(this.toErrorMessage(error, 'Failed to update enabled state.'));
          return EMPTY;
        }),
        finalize(() => this.isMutating.set(false))
      )
      .subscribe();
  }

  deleteTool(tool: ToolRecord) {
    const shouldDelete = window.confirm(`Delete tool "${tool.name}"?`);
    if (!shouldDelete) {
      return;
    }

    this.error.set(null);
    this.isMutating.set(true);

    this.toolService
      .deleteTool(tool.id)
      .pipe(
        tap(() => {
          this.tools.update((records) => records.filter((record) => record.id !== tool.id));
          if (this.editingToolId() === tool.id) {
            this.startCreate();
          }
        }),
        catchError((error) => {
          this.error.set(this.toErrorMessage(error, 'Failed to delete tool.'));
          return EMPTY;
        }),
        finalize(() => this.isMutating.set(false))
      )
      .subscribe();
  }

  private loadTools() {
    this.error.set(null);
    this.isLoading.set(true);

    this.toolService
      .listTools(this.currentFilterValue())
      .pipe(
        tap((tools) => this.tools.set(tools)),
        catchError((error) => {
          this.error.set(this.toErrorMessage(error, 'Failed to load tools.'));
          return EMPTY;
        }),
        finalize(() => this.isLoading.set(false))
      )
      .subscribe();
  }

  private currentFilterValue(): boolean | undefined {
    const filter = this.filter();
    if (filter === 'enabled') {
      return true;
    }
    if (filter === 'disabled') {
      return false;
    }
    return undefined;
  }

  formatOutput(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  private normalizeCode(value: string): string | null {
    const normalized = value.trimEnd();
    return normalized ? normalized : null;
  }

  private parseJsonObject(value: string, message: string): Record<string, unknown> | null {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }

      this.testRunError.set(message);
      return null;
    } catch {
      this.testRunError.set(message);
      return null;
    }
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
