import { Injectable, computed, signal } from '@angular/core';
import { AgentTemplate, cloneTemplate } from '../agent-template.models';
import { AgentTemplateGraph, graphToTemplate, templateToGraph } from '../agent-template-graph.adapters';

export type DraftValidationStatus = 'idle' | 'validating' | 'valid' | 'invalid';

export interface DraftValidationIssue {
  path: string;
  nodeId: string | null;
  message: string;
}

export interface GraphViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface GraphNodeLayout {
  x: number;
  y: number;
  selected: boolean;
}

export interface GraphLayoutState {
  nodeLayoutById: Record<string, GraphNodeLayout>;
  viewport: GraphViewport;
}

const DEFAULT_VIEWPORT: GraphViewport = {
  x: 0,
  y: 0,
  zoom: 1,
};

export const DEFAULT_AGENT_STARTER_TEMPLATE: AgentTemplate = {
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

@Injectable()
export class AgentTemplateDraftStore {
  readonly agentName = signal('');
  readonly baselineVersion = signal<number | null>(null);
  readonly template = signal<AgentTemplate>(cloneTemplate(DEFAULT_AGENT_STARTER_TEMPLATE));

  readonly validationStatus = signal<DraftValidationStatus>('idle');
  readonly validationIssues = signal<DraftValidationIssue[]>([]);
  readonly validateError = signal<string | null>(null);
  readonly validatedFingerprint = signal<string | null>(null);

  readonly graphLayout = signal<GraphLayoutState>({
    nodeLayoutById: this.defaultLayoutForTemplate(DEFAULT_AGENT_STARTER_TEMPLATE),
    viewport: { ...DEFAULT_VIEWPORT },
  });

  readonly graph = computed(() => templateToGraph(this.template()));
  readonly jsonPreview = computed(() => this.prettyJson(this.template()));
  readonly baselineJsonPreview = computed(() => {
    const baseline = this.baselineTemplate();
    return baseline ? this.prettyJson(baseline) : null;
  });

  readonly isDirty = computed(() => this.currentFingerprint() !== this.baselineFingerprint());
  readonly isCurrentDraftValidated = computed(() => this.validatedFingerprint() === this.currentFingerprint());

  readonly validationErrorsByNode = computed<Record<string, string[]>>(() => {
    return this.validationIssues().reduce<Record<string, string[]>>((accumulator, issue) => {
      if (!issue.nodeId) {
        return accumulator;
      }

      const existing = accumulator[issue.nodeId] ?? [];
      accumulator[issue.nodeId] = [...existing, issue.message];
      return accumulator;
    }, {});
  });

  readonly generalValidationErrors = computed(() =>
    this.validationIssues()
      .filter((issue) => !issue.nodeId)
      .map((issue) => issue.message)
  );

  private readonly baselineTemplate = signal<AgentTemplate | null>(cloneTemplate(DEFAULT_AGENT_STARTER_TEMPLATE));
  private readonly baselineName = signal('');

  initializeFromStarter(starterTemplate: AgentTemplate, initialName = '') {
    const template = cloneTemplate(starterTemplate);
    this.agentName.set(initialName);
    this.baselineName.set(initialName);
    this.baselineVersion.set(null);
    this.template.set(template);
    this.baselineTemplate.set(cloneTemplate(template));
    this.graphLayout.set({
      nodeLayoutById: this.defaultLayoutForTemplate(template),
      viewport: { ...DEFAULT_VIEWPORT },
    });
    this.resetValidationState();
  }

  initializeFromExisting(name: string, version: number, template: AgentTemplate) {
    const clone = cloneTemplate(template);
    this.agentName.set(name);
    this.baselineName.set(name);
    this.baselineVersion.set(version);
    this.template.set(clone);
    this.baselineTemplate.set(cloneTemplate(clone));
    this.graphLayout.set({
      nodeLayoutById: this.defaultLayoutForTemplate(clone),
      viewport: { ...DEFAULT_VIEWPORT },
    });
    this.resetValidationState();
  }

  setAgentName(name: string) {
    this.agentName.set(name);
    this.invalidateValidationForAcceptedEdit();
  }

  setTemplate(template: AgentTemplate) {
    const clone = cloneTemplate(template);
    this.template.set(clone);
    this.syncLayoutToTemplate(clone);
    this.invalidateValidationForAcceptedEdit();
  }

  setTemplateFromGraph(graph: AgentTemplateGraph) {
    this.setTemplate(graphToTemplate(graph));
  }

  updateGraphLayoutForNode(nodeId: string, patch: Partial<GraphNodeLayout>) {
    this.graphLayout.update((layout) => {
      const existing = layout.nodeLayoutById[nodeId] ?? { x: 0, y: 0, selected: false };
      return {
        ...layout,
        nodeLayoutById: {
          ...layout.nodeLayoutById,
          [nodeId]: {
            ...existing,
            ...patch,
          },
        },
      };
    });
  }

  renameGraphLayoutNode(currentNodeId: string, nextNodeId: string) {
    if (currentNodeId === nextNodeId) {
      return;
    }

    this.graphLayout.update((layout) => {
      const currentLayout = layout.nodeLayoutById[currentNodeId];
      if (!currentLayout) {
        return layout;
      }

      const remapped = { ...layout.nodeLayoutById };
      delete remapped[currentNodeId];
      remapped[nextNodeId] = currentLayout;

      return {
        ...layout,
        nodeLayoutById: remapped,
      };
    });
  }

  selectGraphNode(nodeId: string | null) {
    this.graphLayout.update((layout) => {
      const entries = Object.entries(layout.nodeLayoutById).map(([existingNodeId, nodeLayout]) => [
        existingNodeId,
        {
          ...nodeLayout,
          selected: nodeId === existingNodeId,
        },
      ]);

      return {
        ...layout,
        nodeLayoutById: Object.fromEntries(entries),
      };
    });
  }

  setViewport(viewport: GraphViewport) {
    this.graphLayout.update((layout) => ({
      ...layout,
      viewport: { ...viewport },
    }));
  }

  startValidation() {
    this.validationStatus.set('validating');
    this.validationIssues.set([]);
    this.validateError.set(null);
  }

  setValidationFailure(message: string) {
    this.validationStatus.set('invalid');
    this.validateError.set(message);
    this.validatedFingerprint.set(null);
  }

  setValidationResult(isValid: boolean, issues: DraftValidationIssue[]) {
    this.validationIssues.set(issues);

    if (isValid) {
      this.validationStatus.set('valid');
      this.validateError.set(null);
      this.validatedFingerprint.set(this.currentFingerprint());
      return;
    }

    this.validationStatus.set('invalid');
    this.validatedFingerprint.set(null);
    this.validateError.set('Template validation failed. Resolve the listed errors and validate again.');
  }

  private invalidateValidationForAcceptedEdit() {
    this.validationStatus.set('idle');
    this.validationIssues.set([]);
    this.validateError.set(null);
    this.validatedFingerprint.set(null);
  }

  private resetValidationState() {
    this.validationStatus.set('idle');
    this.validationIssues.set([]);
    this.validateError.set(null);
    this.validatedFingerprint.set(null);
  }

  private currentFingerprint() {
    return `${this.agentName().trim()}\n${this.jsonPreview()}`;
  }

  private baselineFingerprint() {
    const baselineTemplate = this.baselineTemplate();
    if (!baselineTemplate) {
      return '';
    }

    return `${this.baselineName().trim()}\n${this.prettyJson(baselineTemplate)}`;
  }

  private defaultLayoutForTemplate(template: AgentTemplate) {
    return template.nodes.reduce<Record<string, GraphNodeLayout>>((accumulator, node, index) => {
      accumulator[node.id] = {
        x: 80 + (index % 3) * 280,
        y: 70 + Math.floor(index / 3) * 180,
        selected: false,
      };
      return accumulator;
    }, {});
  }

  private syncLayoutToTemplate(template: AgentTemplate) {
    this.graphLayout.update((layout) => {
      const nextLayout: Record<string, GraphNodeLayout> = {};
      template.nodes.forEach((node, index) => {
        nextLayout[node.id] =
          layout.nodeLayoutById[node.id] ?? {
            x: 80 + (index % 3) * 280,
            y: 70 + Math.floor(index / 3) * 180,
            selected: false,
          };
      });

      return {
        ...layout,
        nodeLayoutById: nextLayout,
      };
    });
  }

  private prettyJson(value: unknown) {
    return JSON.stringify(value, null, 2);
  }
}
