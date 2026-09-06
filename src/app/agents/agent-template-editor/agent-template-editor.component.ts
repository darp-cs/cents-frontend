import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { EMPTY, catchError, finalize, map, of, switchMap, tap } from 'rxjs';
import { AgentService, AgentTemplateRecord } from '../agent.service';

type ValidationStatus = 'idle' | 'validating' | 'valid' | 'invalid';

type JsonTemplate = Record<string, unknown>;

interface ValidationGrouping {
  byNode: Record<string, string[]>;
  general: string[];
}

const STARTER_TEMPLATE: JsonTemplate = {
  template_version: '1.0.0',
  entry_node: 'parse_input',
  guardrails: {
    max_iterations: 3,
    banned_topics_override: null,
    judge_enabled_override: null,
  },
  nodes: [
    {
      id: 'parse_input',
      type: 'structured_parser',
      description: 'Extract structured fields from the last user message.',
      config: {
        source_key: 'last_message',
        strategy: 'regex',
        regex_patterns: {
          amount: '\\b(\\d+(?:\\.\\d{1,2})?)\\b',
          request_type: '\\b(refund|purchase|transfer)\\b',
        },
        fields: [
          {
            name: 'amount',
            type: 'number',
            required: true,
            description: 'Requested amount',
          },
          {
            name: 'request_type',
            type: 'enum',
            required: true,
            enum_values: ['refund', 'purchase', 'transfer'],
            description: 'Type of request extracted from user input',
          },
        ],
      },
      next: 'route_request',
      on_failure: 'final_failure',
    },
    {
      id: 'route_request',
      type: 'condition',
      config: {
        expression: 'parsed_data.amount > 1000',
        input_keys: ['parsed_data.amount'],
      },
      branches: {
        true: 'request_authorization',
        default: 'ask_user_confirmation',
      },
    },
    {
      id: 'request_authorization',
      type: 'service_call',
      config: {
        mode: 'http',
        url: 'https://api.example.com/authorize',
        method: 'POST',
        headers_template: {
          'Content-Type': 'application/json',
        },
        body_template: {
          amount: '{{parsed_data.amount}}',
          request_type: '{{parsed_data.request_type}}',
        },
        timeout_seconds: 20,
      },
      next: 'draft_response',
      on_failure: 'ask_user_confirmation',
    },
    {
      id: 'ask_user_confirmation',
      type: 'user_interrupt',
      config: {
        prompt: 'Please confirm if you want to continue with this request.',
        output_key: 'user_confirmation',
        expected_type: 'confirmation',
      },
      next: 'draft_response',
    },
    {
      id: 'draft_response',
      type: 'llm_step',
      config: {
        model_type: 'reasoning',
        model: 'example-model',
        system_prompt:
          'Summarize request type {{ parsed_data.request_type }}, amount {{ parsed_data.amount }}, and service output {{ service_results }}.',
        max_tokens: 300,
        temperature: 0.2,
        output_key: 'assistant_summary',
      },
      next: 'final_success',
      on_failure: 'final_failure',
    },
    {
      id: 'final_success',
      type: 'terminal_response',
      config: {
        template: 'Request captured successfully.',
        status: 'success',
        include_state_keys: ['parsed_data', 'service_results'],
      },
    },
    {
      id: 'final_failure',
      type: 'terminal_response',
      config: {
        template: 'Request could not be completed. Please review validation issues and retry.',
        status: 'failure',
        include_state_keys: ['parsed_data'],
      },
    },
  ],
};

@Component({
  selector: 'app-agent-template-editor',
  templateUrl: './agent-template-editor.component.html',
  styleUrl: './agent-template-editor.component.css',
})
export class AgentTemplateEditorComponent {
  private readonly agentService = inject(AgentService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly isEditing = signal(false);
  readonly isBootstrapping = signal(false);
  readonly loadError = signal<string | null>(null);

  readonly agentName = signal('');
  readonly draftJson = signal(this.prettyJson(STARTER_TEMPLATE));
  readonly baselineJson = signal<string | null>(null);

  readonly jsonParseError = signal<string | null>(null);
  readonly validationStatus = signal<ValidationStatus>('idle');
  readonly validationErrorsByNode = signal<Record<string, string[]>>({});
  readonly generalValidationErrors = signal<string[]>([]);
  readonly validateError = signal<string | null>(null);

  readonly isSaving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly validatedFingerprint = signal<string | null>(null);

  readonly validationNodeEntries = computed(() =>
    Object.entries(this.validationErrorsByNode())
      .map(([nodeId, errors]) => ({ nodeId, errors }))
      .sort((left, right) => left.nodeId.localeCompare(right.nodeId))
  );

  readonly canValidate = computed(
    () => this.agentName().trim().length > 0 && this.validationStatus() !== 'validating' && !this.isBootstrapping()
  );

  readonly canSave = computed(
    () =>
      this.validationStatus() === 'valid' &&
      this.validatedFingerprint() === this.currentFingerprint() &&
      !this.isSaving() &&
      !this.isBootstrapping()
  );

  constructor() {
    const editingName = this.route.snapshot.paramMap.get('name');
    if (!editingName) {
      return;
    }

    this.isEditing.set(true);
    this.loadExistingTemplate(editingName);
  }

  onAgentNameInput(name: string) {
    if (this.isEditing()) {
      return;
    }

    this.agentName.set(name);
    this.resetValidationState();
  }

  onDraftInput(json: string) {
    this.draftJson.set(json);
    this.resetValidationState();
  }

  validateTemplate() {
    const name = this.agentName().trim();
    if (!name) {
      this.validateError.set('Agent name is required before validation.');
      return;
    }

    const parsedTemplate = this.parseDraftTemplate();
    if (!parsedTemplate) {
      return;
    }

    this.validationStatus.set('validating');
    this.validateError.set(null);
    this.saveError.set(null);

    const validationName = this.buildValidationName(name);

    this.agentService
      .createAgentTemplate(validationName, parsedTemplate)
      .pipe(
        switchMap((record) =>
          this.agentService.deleteAgent(validationName).pipe(
            map(() => record),
            catchError(() => of(record))
          )
        ),
        tap((record) => {
          const rawErrors = this.toValidationErrorMessages(record.validation_errors);
          const grouped = this.groupErrorsByNode(rawErrors, parsedTemplate);

          this.validationErrorsByNode.set(grouped.byNode);
          this.generalValidationErrors.set(grouped.general);

          if (record.is_valid) {
            this.validationStatus.set('valid');
            this.validatedFingerprint.set(this.currentFingerprint());
            this.jsonParseError.set(null);
            return;
          }

          this.validationStatus.set('invalid');
          this.validatedFingerprint.set(null);
          this.validateError.set('Template validation failed. Resolve the listed errors and validate again.');
        }),
        catchError((error) => {
          this.validationStatus.set('invalid');
          this.validatedFingerprint.set(null);
          this.validateError.set(this.toErrorMessage(error, 'Failed to validate template.'));
          return EMPTY;
        })
      )
      .subscribe();
  }

  saveTemplate() {
    if (!this.canSave()) {
      return;
    }

    const name = this.agentName().trim();
    const parsedTemplate = this.parseDraftTemplate();
    if (!parsedTemplate) {
      return;
    }

    this.isSaving.set(true);
    this.saveError.set(null);

    const request$ = this.isEditing()
      ? this.agentService.createAgentVersion(name, parsedTemplate)
      : this.agentService.createAgentTemplate(name, parsedTemplate);

    request$
      .pipe(
        tap(() => {
          void this.router.navigate(['/agents']);
        }),
        catchError((error) => {
          this.saveError.set(this.toErrorMessage(error, 'Failed to save template.'));
          return EMPTY;
        }),
        finalize(() => this.isSaving.set(false))
      )
      .subscribe();
  }

  cancel() {
    void this.router.navigate(['/agents']);
  }

  private loadExistingTemplate(name: string) {
    this.isBootstrapping.set(true);
    this.loadError.set(null);

    this.agentService
      .getLatestAgent(name)
      .pipe(
        tap((record) => this.applyLoadedTemplate(record)),
        catchError((error) => {
          this.loadError.set(this.toErrorMessage(error, 'Failed to load existing template.'));
          return EMPTY;
        }),
        finalize(() => this.isBootstrapping.set(false))
      )
      .subscribe();
  }

  private applyLoadedTemplate(record: AgentTemplateRecord) {
    const baseline = this.prettyJson(record.raw_template ?? {});

    this.agentName.set(record.name);
    this.baselineJson.set(baseline);
    this.draftJson.set(baseline);

    this.resetValidationState();
  }

  private parseDraftTemplate(): JsonTemplate | null {
    try {
      const parsed = JSON.parse(this.draftJson()) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        this.jsonParseError.set('Template must be a JSON object.');
        this.validationStatus.set('invalid');
        this.validatedFingerprint.set(null);
        return null;
      }

      this.jsonParseError.set(null);
      return parsed as JsonTemplate;
    } catch {
      this.jsonParseError.set('Template JSON is invalid. Fix syntax errors and try again.');
      this.validationStatus.set('invalid');
      this.validatedFingerprint.set(null);
      return null;
    }
  }

  private toValidationErrorMessages(raw: unknown): string[] {
    if (Array.isArray(raw)) {
      return raw.map((item) => String(item)).filter((message) => message.trim().length > 0);
    }

    if (typeof raw === 'string' && raw.trim().length > 0) {
      return [raw.trim()];
    }

    return [];
  }

  private groupErrorsByNode(errors: string[], template: JsonTemplate): ValidationGrouping {
    const byNode: Record<string, string[]> = {};
    const general: string[] = [];
    const nodeIds = this.nodeIdsFromTemplate(template);

    for (const message of errors) {
      const explicitNode = /Node '([^']+)'/.exec(message)?.[1];
      if (explicitNode) {
        this.pushNodeError(byNode, explicitNode, message);
        continue;
      }

      const indexedNodeMatch = /nodes(?:\.|\[)(\d+)(?:\.|\])/.exec(message);
      if (indexedNodeMatch) {
        const index = Number(indexedNodeMatch[1]);
        const nodeId = nodeIds[index];
        if (nodeId) {
          this.pushNodeError(byNode, nodeId, message);
          continue;
        }
      }

      general.push(message);
    }

    return { byNode, general };
  }

  private nodeIdsFromTemplate(template: JsonTemplate) {
    const nodes = template['nodes'];
    if (!Array.isArray(nodes)) {
      return [];
    }

    return nodes.map((node) => {
      if (!node || typeof node !== 'object') {
        return '';
      }

      const nodeId = (node as Record<string, unknown>)['id'];
      return typeof nodeId === 'string' ? nodeId : '';
    });
  }

  private pushNodeError(target: Record<string, string[]>, nodeId: string, message: string) {
    const existing = target[nodeId] ?? [];
    target[nodeId] = [...existing, message];
  }

  private resetValidationState() {
    this.validationStatus.set('idle');
    this.validationErrorsByNode.set({});
    this.generalValidationErrors.set([]);
    this.validateError.set(null);
    this.validatedFingerprint.set(null);
    this.saveError.set(null);
  }

  private currentFingerprint() {
    return `${this.agentName().trim()}\n${this.draftJson()}`;
  }

  private buildValidationName(sourceName: string) {
    const sanitized = sourceName.trim().replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40) || 'agent';
    const randomSuffix = Math.random().toString(36).slice(2, 8);
    return `__validate__${sanitized}_${Date.now()}_${randomSuffix}`;
  }

  private prettyJson(value: unknown) {
    return JSON.stringify(value, null, 2);
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
