import { Injectable, computed, signal } from '@angular/core';
import { AgentNodeType, AgentTemplate, AgentTemplateNode, cloneTemplate } from '../agent-template.models';
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

type LayoutPreference = 'existing-first' | 'template-first';

interface SetTemplateOptions {
  layoutPreference?: LayoutPreference;
  invalidateValidation?: boolean;
}

export interface SubAgentExample {
  id: string;
  name: string;
  description: string;
  workflowSource: string;
  template: AgentTemplate;
}

const DEFAULT_VIEWPORT: GraphViewport = {
  x: 0,
  y: 0,
  zoom: 1,
};

const NODE_ID_PREFIX_BY_TYPE: Record<AgentNodeType, string> = {
  structured_parser: 'parse',
  condition: 'decision',
  service_call: 'action',
  user_interrupt: 'interrupt',
  llm_step: 'think',
  terminal_response: 'reply',
};

const LEGACY_STARTER_NODE_IDS = new Set([
  'parse_input',
  'route_request',
  'request_authorization',
  'ask_user_confirmation',
  'draft_response',
  'final_success',
  'final_failure',
]);

const LEGACY_AUTO_NODE_ID_PATTERN_BY_TYPE: Record<AgentNodeType, RegExp> = {
  structured_parser: /^structured_parser_\d+$/,
  condition: /^condition_\d+$/,
  service_call: /^service_call_\d+$/,
  user_interrupt: /^user_interrupt_\d+$/,
  llm_step: /^llm_step_\d+$/,
  terminal_response: /^terminal_response_\d+$/,
};

export const DEFAULT_AGENT_STARTER_TEMPLATE: AgentTemplate = {
  template_version: '1.0.0',
  entry_node: 'parse_1',
  guardrails: {
    max_iterations: 3,
    banned_topics_override: null,
    judge_enabled_override: null,
  },
  nodes: [
    {
      id: 'parse_1',
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
      next: 'decision_1',
      on_failure: 'reply_2',
    },
    {
      id: 'decision_1',
      type: 'condition',
      config: {
        expression: 'parsed_data.amount > 1000',
        input_keys: ['parsed_data.amount'],
      },
      branches: {
        true: 'action_1',
        default: 'interrupt_1',
      },
    },
    {
      id: 'action_1',
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
      next: 'think_1',
      on_failure: 'interrupt_1',
    },
    {
      id: 'interrupt_1',
      type: 'user_interrupt',
      config: {
        prompt: 'Please confirm if you want to continue with this request.',
        output_key: 'user_confirmation',
        expected_type: 'confirmation',
      },
      next: 'think_1',
    },
    {
      id: 'think_1',
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
      next: 'reply_1',
      on_failure: 'reply_2',
    },
    {
      id: 'reply_1',
      type: 'terminal_response',
      config: {
        template: 'Request captured successfully.',
        status: 'success',
        include_state_keys: ['parsed_data', 'service_results'],
      },
    },
    {
      id: 'reply_2',
      type: 'terminal_response',
      config: {
        template: 'Request could not be completed. Please review validation issues and retry.',
        status: 'failure',
        include_state_keys: ['parsed_data'],
      },
    },
  ],
  canvas_layout: {
    node_positions: {
      parse_1: { x: 220, y: 70 },
      decision_1: { x: 220, y: 250 },
      action_1: { x: 70, y: 430 },
      interrupt_1: { x: 370, y: 430 },
      think_1: { x: 220, y: 610 },
      reply_1: { x: 70, y: 790 },
      reply_2: { x: 370, y: 790 },
    },
    viewport: { ...DEFAULT_VIEWPORT },
  },
};

export const SUB_AGENT_EXAMPLES: readonly SubAgentExample[] = [
  {
    id: 'expense-triage',
    name: 'Expense Triage',
    description: 'Parse an expense request, route high-value approvals, and reply with a summary.',
    workflowSource: [
      'Expense Triage',
      '',
      '@start Parse the latest expense request',
      '@listen for amount and request type',
      '@if amount is greater than 1000',
      '  @call the authorization service',
      '@else',
      '  @interrupt Ask for user confirmation',
      '@think Summarize the final decision',
      '@reply Return the summary to the user',
    ].join('\n'),
    template: cloneTemplate(DEFAULT_AGENT_STARTER_TEMPLATE),
  },
  {
    id: 'meeting-planner',
    name: 'Meeting Planner',
    description: 'Collect scheduling constraints, look up availability, and draft proposed meeting slots.',
    workflowSource: [
      'Meeting Planner',
      '',
      '@start Parse participant names, date, and timezone',
      '@if timezone is provided',
      '  @call the calendar lookup tool',
      '@else',
      '  @interrupt Ask the user for timezone',
      '@think Propose three options with rationale',
      '@reply Present options and ask for confirmation',
    ].join('\n'),
    template: {
      template_version: '1.0.0',
      entry_node: 'parse_1',
      guardrails: {
        max_iterations: 3,
        banned_topics_override: null,
        judge_enabled_override: null,
      },
      nodes: [
        {
          id: 'parse_1',
          type: 'structured_parser',
          description: 'Extract participant, date, and timezone fields.',
          config: {
            source_key: 'last_message',
            strategy: 'regex',
            regex_patterns: {
              participants: 'participants?\\s*[:=]\\s*([^\\n]+)',
              meeting_date: '\\b(\\d{4}-\\d{2}-\\d{2})\\b',
              timezone: 'timezone\\s*[:=]\\s*([A-Za-z_\\/+\\-]+)',
            },
            fields: [
              { name: 'participants', type: 'array', required: true, description: 'Requested participants' },
              { name: 'meeting_date', type: 'date', required: true, description: 'Requested date' },
              { name: 'timezone', type: 'string', required: false, description: 'User timezone' },
            ],
          },
          next: 'decision_1',
          on_failure: 'reply_2',
        },
        {
          id: 'decision_1',
          type: 'condition',
          config: {
            expression: 'parsed_data.timezone != null and parsed_data.timezone != ""',
            input_keys: ['parsed_data.timezone'],
          },
          branches: {
            true: 'action_1',
            default: 'interrupt_1',
          },
        },
        {
          id: 'interrupt_1',
          type: 'user_interrupt',
          description: 'Ask for missing timezone before scheduling.',
          config: {
            prompt: 'Please share your timezone (for example, America/New_York).',
            output_key: 'timezone_answer',
            expected_type: 'text',
          },
          next: 'action_1',
        },
        {
          id: 'action_1',
          type: 'service_call',
          description: 'Lookup available meeting slots from the calendar tool.',
          config: {
            mode: 'tool',
            method: 'POST',
            tool_name: 'calendar_lookup',
            headers_template: {},
            tool_input_template: {
              participants: '{{ parsed_data.participants }}',
              date: '{{ parsed_data.meeting_date }}',
              timezone: '{{ parsed_data.timezone }}',
            },
            timeout_seconds: 30,
            allow_unsafe_destination: false,
          },
          next: 'think_1',
          on_failure: 'reply_2',
        },
        {
          id: 'think_1',
          type: 'llm_step',
          description: 'Draft concise scheduling options.',
          config: {
            model_type: 'reasoning',
            model: null,
            system_prompt:
              'Using {{ service_results.action_1.body }}, provide three meeting options and one sentence of rationale per option.',
            max_tokens: 280,
            temperature: 0.2,
            output_key: 'meeting_options',
          },
          next: 'reply_1',
          on_failure: 'reply_2',
        },
        {
          id: 'reply_1',
          type: 'terminal_response',
          config: {
            template: '{{ parsed_data.meeting_options }}',
            status: 'success',
            include_state_keys: ['parsed_data', 'service_results'],
          },
        },
        {
          id: 'reply_2',
          type: 'terminal_response',
          config: {
            template: 'I could not build meeting options. Please verify participants and date, then try again.',
            status: 'failure',
            include_state_keys: ['parsed_data'],
          },
        },
      ],
      canvas_layout: {
        node_positions: {
          parse_1: { x: 220, y: 70 },
          decision_1: { x: 220, y: 250 },
          interrupt_1: { x: 370, y: 430 },
          action_1: { x: 70, y: 430 },
          think_1: { x: 220, y: 610 },
          reply_1: { x: 70, y: 790 },
          reply_2: { x: 370, y: 790 },
        },
        viewport: { ...DEFAULT_VIEWPORT },
      },
    },
  },
  {
    id: 'support-escalation',
    name: 'Support Escalation',
    description: 'Parse an issue, decide escalation path, and produce a final support response.',
    workflowSource: [
      'Support Escalation',
      '',
      '@start Parse issue type and urgency',
      '@if urgent is true',
      '  @call the escalation ticket tool',
      '@else if issue type is billing',
      '  @interrupt Ask for invoice id',
      '  @call the billing lookup service',
      '@else',
      '  @reply Send self-service guidance',
      '@think Summarize status and next steps',
      '@reply Return the final support response',
    ].join('\n'),
    template: {
      template_version: '1.0.0',
      entry_node: 'parse_1',
      guardrails: {
        max_iterations: 4,
        banned_topics_override: null,
        judge_enabled_override: null,
      },
      nodes: [
        {
          id: 'parse_1',
          type: 'structured_parser',
          description: 'Extract issue type and urgency from the message.',
          config: {
            source_key: 'last_message',
            strategy: 'regex',
            regex_patterns: {
              issue_type: '\\b(billing|access|bug)\\b',
              urgent: '\\b(urgent|critical|asap)\\b',
            },
            fields: [
              {
                name: 'issue_type',
                type: 'enum',
                required: true,
                enum_values: ['billing', 'access', 'bug'],
                description: 'Primary support issue type',
              },
              {
                name: 'urgent',
                type: 'boolean',
                required: false,
                description: 'Whether the issue is urgent',
              },
            ],
          },
          next: 'decision_1',
          on_failure: 'reply_2',
        },
        {
          id: 'decision_1',
          type: 'condition',
          config: {
            expression: 'parsed_data.urgent == true',
            input_keys: ['parsed_data.urgent'],
          },
          branches: {
            true: 'action_1',
            default: 'decision_2',
          },
        },
        {
          id: 'decision_2',
          type: 'condition',
          config: {
            expression: 'parsed_data.issue_type == "billing"',
            input_keys: ['parsed_data.issue_type'],
          },
          branches: {
            true: 'interrupt_1',
            default: 'reply_3',
          },
        },
        {
          id: 'interrupt_1',
          type: 'user_interrupt',
          description: 'Ask for invoice identifier when billing details are missing.',
          config: {
            prompt: 'Please provide your invoice ID so I can check billing status.',
            output_key: 'invoice_id',
            expected_type: 'text',
          },
          next: 'action_2',
        },
        {
          id: 'action_1',
          type: 'service_call',
          description: 'Create an urgent escalation ticket.',
          config: {
            mode: 'tool',
            method: 'POST',
            tool_name: 'escalation_ticket',
            headers_template: {},
            tool_input_template: {
              issue_type: '{{ parsed_data.issue_type }}',
              urgent: '{{ parsed_data.urgent }}',
            },
            timeout_seconds: 30,
            allow_unsafe_destination: false,
          },
          next: 'think_1',
          on_failure: 'reply_2',
        },
        {
          id: 'action_2',
          type: 'service_call',
          description: 'Fetch billing status details.',
          config: {
            mode: 'http',
            url: 'https://api.example.com/billing/status',
            method: 'POST',
            headers_template: {
              'Content-Type': 'application/json',
            },
            body_template: {
              invoice_id: '{{ parsed_data.invoice_id }}',
            },
            timeout_seconds: 30,
            allow_unsafe_destination: false,
          },
          next: 'think_1',
          on_failure: 'reply_2',
        },
        {
          id: 'think_1',
          type: 'llm_step',
          description: 'Generate customer-facing summary and next steps.',
          config: {
            model_type: 'reasoning',
            model: null,
            system_prompt:
              'Summarize service results {{ service_results }} into clear next steps for the user.',
            max_tokens: 280,
            temperature: 0.2,
            output_key: 'support_summary',
          },
          next: 'reply_1',
          on_failure: 'reply_2',
        },
        {
          id: 'reply_1',
          type: 'terminal_response',
          config: {
            template: '{{ parsed_data.support_summary }}',
            status: 'success',
            include_state_keys: ['parsed_data', 'service_results'],
          },
        },
        {
          id: 'reply_2',
          type: 'terminal_response',
          config: {
            template: 'I could not complete escalation. Please try again with more details.',
            status: 'failure',
            include_state_keys: ['parsed_data'],
          },
        },
        {
          id: 'reply_3',
          type: 'terminal_response',
          config: {
            template: 'This issue can be handled without escalation. I can guide you through self-service steps.',
            status: 'success',
            include_state_keys: ['parsed_data'],
          },
        },
      ],
      canvas_layout: {
        node_positions: {
          parse_1: { x: 220, y: 70 },
          decision_1: { x: 220, y: 250 },
          action_1: { x: 70, y: 430 },
          decision_2: { x: 370, y: 430 },
          interrupt_1: { x: 370, y: 610 },
          action_2: { x: 370, y: 790 },
          think_1: { x: 220, y: 970 },
          reply_1: { x: 70, y: 1150 },
          reply_2: { x: 220, y: 1150 },
          reply_3: { x: 370, y: 1150 },
        },
        viewport: { ...DEFAULT_VIEWPORT },
      },
    },
  },
] as const;

@Injectable()
export class AgentTemplateDraftStore {
  readonly agentName = signal('');
  readonly baselineVersion = signal<number | null>(null);
  readonly template = signal<AgentTemplate>(cloneTemplate(DEFAULT_AGENT_STARTER_TEMPLATE));

  readonly validationStatus = signal<DraftValidationStatus>('idle');
  readonly validationIssues = signal<DraftValidationIssue[]>([]);
  readonly validateError = signal<string | null>(null);
  readonly validatedFingerprint = signal<string | null>(null);

  readonly graphLayout = signal<GraphLayoutState>(this.resolveLayoutForTemplate(DEFAULT_AGENT_STARTER_TEMPLATE, null, 'template-first'));

  readonly graph = computed(() => templateToGraph(this.template()));
  readonly jsonPreview = computed(() => this.prettyJson(this.templateForPersistence()));
  readonly baselineJsonPreview = computed(() => {
    const baseline = this.baselineTemplate();
    return baseline ? this.prettyJson(this.withCanvasLayout(baseline, this.baselineLayout())) : null;
  });

  readonly isDirty = computed(() => this.currentDraftFingerprint() !== this.baselineDraftFingerprint());
  readonly isCurrentDraftValidated = computed(() => this.validatedFingerprint() === this.currentValidationFingerprint());

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
  private readonly baselineLayout = signal<GraphLayoutState>(
    this.resolveLayoutForTemplate(DEFAULT_AGENT_STARTER_TEMPLATE, null, 'template-first')
  );
  private readonly baselineName = signal('');

  initializeFromStarter(starterTemplate: AgentTemplate, initialName = '') {
    const template = this.normalizeTemplateForEditor(starterTemplate);
    const layout = this.resolveLayoutForTemplate(template, null, 'template-first');
    this.agentName.set(initialName);
    this.baselineName.set(initialName);
    this.baselineVersion.set(null);
    this.template.set(template);
    this.baselineTemplate.set(cloneTemplate(template));
    this.graphLayout.set(layout);
    this.baselineLayout.set(this.cloneLayout(layout));
    this.resetValidationState();
  }

  initializeFromExisting(name: string, version: number, template: AgentTemplate) {
    const clone = this.normalizeTemplateForEditor(template);
    const layout = this.resolveLayoutForTemplate(clone, null, 'template-first');
    this.agentName.set(name);
    this.baselineName.set(name);
    this.baselineVersion.set(version);
    this.template.set(clone);
    this.baselineTemplate.set(cloneTemplate(clone));
    this.graphLayout.set(layout);
    this.baselineLayout.set(this.cloneLayout(layout));
    this.resetValidationState();
  }

  setAgentName(name: string) {
    this.agentName.set(name);
    this.invalidateValidationForAcceptedEdit();
  }

  setTemplate(template: AgentTemplate, options: SetTemplateOptions = {}) {
    const clone = this.normalizeTemplateForEditor(template);
    this.template.set(clone);
    this.syncLayoutToTemplate(clone, options.layoutPreference ?? 'existing-first');
    if (options.invalidateValidation ?? true) {
      this.invalidateValidationForAcceptedEdit();
    }
  }

  setTemplateFromGraph(graph: AgentTemplateGraph) {
    this.setTemplate(graphToTemplate(graph), { layoutPreference: 'existing-first' });
  }

  templateForPersistence(): AgentTemplate {
    return this.withCanvasLayout(this.template(), this.graphLayout());
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

  setGraphLayout(layout: GraphLayoutState) {
    this.graphLayout.set({
      nodeLayoutById: { ...layout.nodeLayoutById },
      viewport: { ...layout.viewport },
    });
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
      this.validatedFingerprint.set(this.currentValidationFingerprint());
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

  private currentValidationFingerprint() {
    return `${this.agentName().trim()}\n${this.prettyJson(this.withoutCanvasLayout(this.template()))}`;
  }

  private currentDraftFingerprint() {
    return `${this.agentName().trim()}\n${this.jsonPreview()}`;
  }

  private baselineDraftFingerprint() {
    const baselineTemplate = this.baselineTemplate();
    if (!baselineTemplate) {
      return '';
    }

    return `${this.baselineName().trim()}\n${this.prettyJson(this.withCanvasLayout(baselineTemplate, this.baselineLayout()))}`;
  }

  private defaultLayoutForTemplate(template: AgentTemplate) {
    const nodesById = new Map(template.nodes.map((node) => [node.id, node]));
    const depthById = new Map<string, number>();

    if (nodesById.has(template.entry_node)) {
      const queue: string[] = [template.entry_node];
      depthById.set(template.entry_node, 0);

      while (queue.length > 0) {
        const currentId = queue.shift() as string;
        const node = nodesById.get(currentId);
        if (!node) {
          continue;
        }

        const depth = depthById.get(currentId) ?? 0;
        for (const targetId of this.outgoingTargets(node)) {
          if (!nodesById.has(targetId)) {
            continue;
          }

          const knownDepth = depthById.get(targetId);
          const nextDepth = depth + 1;
          if (knownDepth === undefined || nextDepth < knownDepth) {
            depthById.set(targetId, nextDepth);
            queue.push(targetId);
          }
        }
      }
    }

    const deepestKnown = depthById.size > 0 ? Math.max(...depthById.values()) : 0;
    let fallbackDepth = deepestKnown + 1;
    const groupsByDepth = new Map<number, string[]>();

    for (const node of template.nodes) {
      const depth = depthById.get(node.id) ?? fallbackDepth++;
      const group = groupsByDepth.get(depth) ?? [];
      group.push(node.id);
      groupsByDepth.set(depth, group);
    }

    const sortedDepths = Array.from(groupsByDepth.keys()).sort((left, right) => left - right);
    const layout: Record<string, GraphNodeLayout> = {};
    for (const depth of sortedDepths) {
      const nodesAtDepth = groupsByDepth.get(depth) ?? [];
      nodesAtDepth.forEach((nodeId, index) => {
        layout[nodeId] = {
          x: 80 + index * 280,
          y: 70 + depth * 180,
          selected: false,
        };
      });
    }

    return layout;
  }

  private syncLayoutToTemplate(template: AgentTemplate, preference: LayoutPreference) {
    this.graphLayout.update((layout) => this.resolveLayoutForTemplate(template, layout, preference));
  }

  private resolveLayoutForTemplate(
    template: AgentTemplate,
    current: GraphLayoutState | null,
    preference: LayoutPreference
  ): GraphLayoutState {
    const defaultNodeLayoutById = this.defaultLayoutForTemplate(template);
    const persistedLayout = this.readLayoutFromTemplate(template);
    const currentLayout = current ?? {
      nodeLayoutById: {},
      viewport: { ...DEFAULT_VIEWPORT },
    };

    const nextNodeLayoutById: Record<string, GraphNodeLayout> = {};
    template.nodes.forEach((node) => {
      const existingNode = currentLayout.nodeLayoutById[node.id];
      const persistedNode = persistedLayout?.nodeLayoutById[node.id];
      const fallback = defaultNodeLayoutById[node.id] ?? { x: 80, y: 70, selected: false };

      const preferredNode =
        preference === 'template-first'
          ? persistedNode ?? existingNode ?? fallback
          : existingNode ?? persistedNode ?? fallback;

      nextNodeLayoutById[node.id] = {
        x: preferredNode.x,
        y: preferredNode.y,
        selected: existingNode?.selected ?? false,
      };
    });

    const viewport =
      preference === 'template-first'
        ? persistedLayout?.viewport ?? currentLayout.viewport
        : currentLayout.viewport ?? persistedLayout?.viewport ?? { ...DEFAULT_VIEWPORT };

    return {
      nodeLayoutById: nextNodeLayoutById,
      viewport: { ...viewport },
    };
  }

  private readLayoutFromTemplate(template: AgentTemplate): GraphLayoutState | null {
    const layout = template.canvas_layout;
    if (!layout || typeof layout !== 'object' || Array.isArray(layout)) {
      return null;
    }

    const rawPositions = layout.node_positions;
    if (!rawPositions || typeof rawPositions !== 'object' || Array.isArray(rawPositions)) {
      return null;
    }

    const validNodeIds = new Set(template.nodes.map((node) => node.id));
    const nodeLayoutById: Record<string, GraphNodeLayout> = {};
    for (const [nodeId, rawPosition] of Object.entries(rawPositions)) {
      if (!validNodeIds.has(nodeId)) {
        continue;
      }

      if (!rawPosition || typeof rawPosition !== 'object' || Array.isArray(rawPosition)) {
        continue;
      }

      const x = (rawPosition as { x?: unknown }).x;
      const y = (rawPosition as { y?: unknown }).y;
      if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
        continue;
      }

      nodeLayoutById[nodeId] = {
        x,
        y,
        selected: false,
      };
    }

    const viewport = this.coerceViewport(layout.viewport);
    return {
      nodeLayoutById,
      viewport,
    };
  }

  private withCanvasLayout(template: AgentTemplate, layout: GraphLayoutState): AgentTemplate {
    const clone = this.withoutCanvasLayout(template);
    const defaultNodeLayoutById = this.defaultLayoutForTemplate(clone);
    const node_positions = clone.nodes.reduce<Record<string, { x: number; y: number }>>((accumulator, node) => {
      const position = layout.nodeLayoutById[node.id] ?? defaultNodeLayoutById[node.id] ?? { x: 80, y: 70, selected: false };
      accumulator[node.id] = { x: position.x, y: position.y };
      return accumulator;
    }, {});

    clone.canvas_layout = {
      node_positions,
      viewport: {
        x: layout.viewport.x,
        y: layout.viewport.y,
        zoom: layout.viewport.zoom,
      },
    };
    return clone;
  }

  private withoutCanvasLayout(template: AgentTemplate): AgentTemplate {
    const clone = cloneTemplate(template);
    if ('canvas_layout' in clone) {
      delete clone.canvas_layout;
    }
    return clone;
  }

  private cloneLayout(layout: GraphLayoutState): GraphLayoutState {
    return {
      nodeLayoutById: Object.fromEntries(
        Object.entries(layout.nodeLayoutById).map(([nodeId, nodeLayout]) => [nodeId, { ...nodeLayout }])
      ),
      viewport: { ...layout.viewport },
    };
  }

  private coerceViewport(value: unknown): GraphViewport {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ...DEFAULT_VIEWPORT };
    }

    const x = (value as { x?: unknown }).x;
    const y = (value as { y?: unknown }).y;
    const zoom = (value as { zoom?: unknown }).zoom;
    if (
      typeof x !== 'number' ||
      !Number.isFinite(x) ||
      typeof y !== 'number' ||
      !Number.isFinite(y) ||
      typeof zoom !== 'number' ||
      !Number.isFinite(zoom) ||
      zoom <= 0
    ) {
      return { ...DEFAULT_VIEWPORT };
    }

    return { x, y, zoom };
  }

  private outgoingTargets(node: AgentTemplateNode): string[] {
    if (node.type === 'condition') {
      return Object.values(node.branches);
    }

    if (node.type === 'terminal_response') {
      return [];
    }

    if ('on_failure' in node && node.on_failure) {
      return [node.next, node.on_failure];
    }

    return [node.next];
  }

  private normalizeTemplateForEditor(template: AgentTemplate): AgentTemplate {
    const clone = cloneTemplate(template);
    const nodeIdMapping = this.buildLegacyNodeIdMapping(clone);
    if (Object.keys(nodeIdMapping).length === 0) {
      return clone;
    }

    const remappedNodes = clone.nodes.map((node) => {
      const nextNodeId = nodeIdMapping[node.id] ?? node.id;
      switch (node.type) {
        case 'structured_parser':
          return {
            ...node,
            id: nextNodeId,
            next: nodeIdMapping[node.next] ?? node.next,
            ...(node.on_failure ? { on_failure: nodeIdMapping[node.on_failure] ?? node.on_failure } : {}),
            config: this.remapNodeConfigStrings(node.config, nodeIdMapping) as typeof node.config,
          };
        case 'service_call':
          return {
            ...node,
            id: nextNodeId,
            next: nodeIdMapping[node.next] ?? node.next,
            ...(node.on_failure ? { on_failure: nodeIdMapping[node.on_failure] ?? node.on_failure } : {}),
            config: this.remapNodeConfigStrings(node.config, nodeIdMapping) as typeof node.config,
          };
        case 'llm_step':
          return {
            ...node,
            id: nextNodeId,
            next: nodeIdMapping[node.next] ?? node.next,
            ...(node.on_failure ? { on_failure: nodeIdMapping[node.on_failure] ?? node.on_failure } : {}),
            config: this.remapNodeConfigStrings(node.config, nodeIdMapping) as typeof node.config,
          };
        case 'user_interrupt':
          return {
            ...node,
            id: nextNodeId,
            next: nodeIdMapping[node.next] ?? node.next,
            config: this.remapNodeConfigStrings(node.config, nodeIdMapping) as typeof node.config,
          };
        case 'condition':
          return {
            ...node,
            id: nextNodeId,
            branches: Object.fromEntries(
              Object.entries(node.branches).map(([label, target]) => [label, nodeIdMapping[target] ?? target])
            ),
            config: this.remapNodeConfigStrings(node.config, nodeIdMapping) as typeof node.config,
          };
        case 'terminal_response':
          return {
            ...node,
            id: nextNodeId,
            config: this.remapNodeConfigStrings(node.config, nodeIdMapping) as typeof node.config,
          };
      }
    });

    const remappedTemplate: AgentTemplate = {
      ...clone,
      entry_node: nodeIdMapping[clone.entry_node] ?? clone.entry_node,
      nodes: remappedNodes,
      ...(clone.canvas_layout
        ? {
            canvas_layout: {
              ...clone.canvas_layout,
              node_positions: Object.fromEntries(
                Object.entries(clone.canvas_layout.node_positions ?? {}).map(([nodeId, position]) => [
                  nodeIdMapping[nodeId] ?? nodeId,
                  position,
                ])
              ),
            },
          }
        : {}),
    };

    return remappedTemplate;
  }

  private buildLegacyNodeIdMapping(template: AgentTemplate): Record<string, string> {
    const shouldRename = (node: AgentTemplateNode) => {
      if (LEGACY_STARTER_NODE_IDS.has(node.id)) {
        return true;
      }

      // Only migrate IDs that were auto-generated by older editors.
      return LEGACY_AUTO_NODE_ID_PATTERN_BY_TYPE[node.type].test(node.id);
    };

    const nodesToRename = template.nodes.filter((node) => shouldRename(node));
    if (nodesToRename.length === 0) {
      return {};
    }

    const usedNodeIds = new Set(template.nodes.filter((node) => !shouldRename(node)).map((node) => node.id));
    const countsByPrefix = Object.values(NODE_ID_PREFIX_BY_TYPE).reduce<Record<string, number>>((accumulator, prefix) => {
      accumulator[prefix] = 1;
      return accumulator;
    }, {});

    const mapping: Record<string, string> = {};
    for (const node of template.nodes) {
      if (!shouldRename(node)) {
        continue;
      }

      const prefix = NODE_ID_PREFIX_BY_TYPE[node.type];
      let sequence = countsByPrefix[prefix] ?? 1;
      let candidate = `${prefix}_${sequence}`;
      while (usedNodeIds.has(candidate)) {
        sequence += 1;
        candidate = `${prefix}_${sequence}`;
      }

      countsByPrefix[prefix] = sequence + 1;
      mapping[node.id] = candidate;
      usedNodeIds.add(candidate);
    }

    return mapping;
  }

  private remapNodeConfigStrings(value: unknown, mapping: Record<string, string>): unknown {
    if (typeof value === 'string') {
      return this.remapServiceResultReferences(value, mapping);
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.remapNodeConfigStrings(item, mapping));
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    const next: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, itemValue]) => {
      next[key] = this.remapNodeConfigStrings(itemValue, mapping);
    });
    return next;
  }

  private remapServiceResultReferences(value: string, mapping: Record<string, string>): string {
    let rendered = value;
    Object.entries(mapping).forEach(([legacyId, nextId]) => {
      const escapedLegacyId = legacyId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      rendered = rendered.replace(
        new RegExp(`service_results\\.${escapedLegacyId}(?=[^A-Za-z0-9_]|$)`, 'g'),
        `service_results.${nextId}`
      );
      rendered = rendered.replace(
        new RegExp(`service_results\\[['"]${escapedLegacyId}['"]\\]`, 'g'),
        `service_results["${nextId}"]`
      );
    });
    return rendered;
  }

  private prettyJson(value: unknown) {
    return JSON.stringify(value, null, 2);
  }
}
