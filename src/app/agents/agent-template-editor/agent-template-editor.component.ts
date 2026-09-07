import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { EMPTY, catchError, finalize, tap } from 'rxjs';
import { AgentAuthoringSchemaResponse, AgentService, AgentTemplateRecord } from '../agent.service';
import { AgentNodeType, AgentTemplate, AgentTemplateNode, cloneTemplate, isAgentTemplate } from '../agent-template.models';
import { AgentTemplateGraph } from '../agent-template-graph.adapters';
import {
  AgentTemplateDraftStore,
  DEFAULT_AGENT_STARTER_TEMPLATE,
  DraftValidationIssue,
  GraphLayoutState,
} from './agent-template-draft.store';
import { AgentCanvasPaletteItem, AgentWorkflowCanvasComponent } from './agent-workflow-canvas.component';

type EditorMode = 'natural-language' | 'visual-graph' | 'advanced-json';

interface AuthoringMessage {
  role: 'user' | 'assistant';
  content: string;
  status?: 'applied' | 'not-applied';
}

interface AuthoringToken {
  token: string;
  label: string;
  description: string;
}

const SUPPORTED_NODE_TYPES: AgentNodeType[] = [
  'structured_parser',
  'condition',
  'service_call',
  'user_interrupt',
  'llm_step',
  'terminal_response',
];

const DEFAULT_PALETTE: AgentCanvasPaletteItem[] = [
  {
    type: 'structured_parser',
    label: 'Structured Parser',
    icon: 'SP',
    description: 'Extract structured fields from input before branching.',
  },
  {
    type: 'condition',
    label: 'Condition',
    icon: '?',
    description: 'Route execution through named branch keys.',
  },
  {
    type: 'service_call',
    label: 'Service Call',
    icon: 'API',
    description: 'Invoke HTTP endpoints or tools to fetch external data.',
  },
  {
    type: 'user_interrupt',
    label: 'User Interrupt',
    icon: 'USR',
    description: 'Pause execution and ask the user for explicit input.',
  },
  {
    type: 'llm_step',
    label: 'LLM Step',
    icon: 'LLM',
    description: 'Generate model output based on state context.',
  },
  {
    type: 'terminal_response',
    label: 'Terminal Response',
    icon: 'END',
    description: 'Finalize the workflow with a success or failure response.',
  },
];

const ICON_BY_NODE_TYPE: Record<AgentNodeType, string> = {
  structured_parser: 'SP',
  condition: '?',
  service_call: 'API',
  user_interrupt: 'USR',
  llm_step: 'LLM',
  terminal_response: 'END',
};

const DATA_REFERENCE_TOKENS: AuthoringToken[] = [
  { token: '#last_message', label: 'Latest user message', description: 'The most recent message from the user.' },
  { token: '#parsed_data', label: 'Parsed data', description: 'Structured fields extracted earlier in the workflow.' },
  { token: '#service_results', label: 'Service results', description: 'Data returned by service or tool calls.' },
];

const UNIT_COMMAND_TOKENS: AuthoringToken[] = [
  { token: '/listen', label: 'Listen', description: 'Add a component that extracts structured information.' },
  { token: '/if', label: 'Condition', description: 'Add an IF/otherwise decision.' },
  { token: '/call', label: 'Call service', description: 'Add an HTTP or tool call.' },
  { token: '/ask', label: 'Ask user', description: 'Pause and ask the user for information.' },
  { token: '/think', label: 'Model step', description: 'Add an LLM reasoning or writing step.' },
  { token: '/reply', label: 'Reply', description: 'Add a final response to the user.' },
];

@Component({
  selector: 'app-agent-template-editor',
  templateUrl: './agent-template-editor.component.html',
  styleUrl: './agent-template-editor.component.css',
  imports: [AgentWorkflowCanvasComponent],
  providers: [AgentTemplateDraftStore],
})
export class AgentTemplateEditorComponent {
  private readonly agentService = inject(AgentService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly draftStore = inject(AgentTemplateDraftStore);

  readonly isEditing = signal(false);
  readonly isBootstrapping = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly saveError = signal<string | null>(null);
  readonly isSaving = signal(false);
  readonly editorMode = signal<EditorMode>('natural-language');
  readonly exportMessage = signal<string | null>(null);
  readonly paletteLoading = signal(true);
  readonly paletteError = signal<string | null>(null);
  readonly paletteItems = signal<AgentCanvasPaletteItem[]>(DEFAULT_PALETTE);
  readonly authoringPrompt = signal('');
  readonly isGenerating = signal(false);
  readonly generationError = signal<string | null>(null);
  readonly authoringMessages = signal<AuthoringMessage[]>([
    {
      role: 'assistant',
      content: 'Describe the workflow you want. Reference components with @, data with #, or insert a unit with /.',
    },
  ]);
  readonly dataReferenceTokens = DATA_REFERENCE_TOKENS;
  readonly unitCommandTokens = UNIT_COMMAND_TOKENS;

  readonly agentName = this.draftStore.agentName;
  readonly baselineVersion = this.draftStore.baselineVersion;
  readonly template = this.draftStore.template;
  readonly draftJsonPreview = this.draftStore.jsonPreview;
  readonly baselineJson = this.draftStore.baselineJsonPreview;
  readonly graph = this.draftStore.graph;
  readonly graphLayout = this.draftStore.graphLayout;
  readonly isDirty = this.draftStore.isDirty;

  readonly validationStatus = this.draftStore.validationStatus;
  readonly validateError = this.draftStore.validateError;
  readonly validationErrorsByNode = this.draftStore.validationErrorsByNode;
  readonly generalValidationErrors = this.draftStore.generalValidationErrors;

  readonly validationNodeEntries = computed(() =>
    Object.entries(this.validationErrorsByNode())
      .map(([nodeId, errors]) => ({ nodeId, errors }))
      .sort((left, right) => left.nodeId.localeCompare(right.nodeId))
  );

  readonly nodeIds = computed(() => this.template().nodes.map((node) => node.id));
  readonly componentReferenceTokens = computed<AuthoringToken[]>(() =>
    this.template().nodes.map((node) => ({
      token: `@${node.id}`,
      label: node.id,
      description: `${this.nodeTypeLabel(node)} component`,
    }))
  );
  readonly canGenerate = computed(() => this.authoringPrompt().trim().length > 0 && !this.isGenerating());

  readonly canValidate = computed(
    () => this.agentName().trim().length > 0 && this.validationStatus() !== 'validating' && !this.isBootstrapping()
  );

  readonly canSave = computed(
    () =>
      this.validationStatus() === 'valid' &&
      this.draftStore.isCurrentDraftValidated() &&
      !this.isSaving() &&
      !this.isBootstrapping()
  );

  constructor() {
    this.draftStore.initializeFromStarter(DEFAULT_AGENT_STARTER_TEMPLATE);
    this.loadAuthoringSchemaCatalog();

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

    this.draftStore.setAgentName(name);
  }

  setEditorMode(mode: EditorMode) {
    this.editorMode.set(mode);
  }

  onAuthoringPromptInput(value: string) {
    this.authoringPrompt.set(value);
    this.generationError.set(null);
  }

  insertAuthoringToken(token: string) {
    const current = this.authoringPrompt();
    const separator = current.length > 0 && !/\s$/.test(current) ? ' ' : '';
    this.authoringPrompt.set(`${current}${separator}${token} `);
  }

  generateFromDescription() {
    const prompt = this.authoringPrompt().trim();
    if (!prompt || this.isGenerating()) {
      return;
    }

    this.authoringMessages.update((messages) => [...messages, { role: 'user', content: prompt }]);
    this.authoringPrompt.set('');
    this.generationError.set(null);
    this.isGenerating.set(true);

    this.agentService
      .generateAuthoringTemplate(prompt, this.template())
      .pipe(
        tap((result) => {
          const generatedTemplate = result.generated_template;
          if (result.is_valid && generatedTemplate && isAgentTemplate(generatedTemplate)) {
            this.draftStore.setTemplate(generatedTemplate);
            this.draftStore.setValidationResult(true, []);
            this.authoringMessages.update((messages) => [
              ...messages,
              { role: 'assistant', content: result.message, status: 'applied' },
            ]);
            return;
          }

          const details = result.errors.map((error) => error.message).join(' ');
          const message = details || 'The generated workflow did not pass validation, so your current draft was kept.';
          this.generationError.set(message);
          this.authoringMessages.update((messages) => [
            ...messages,
            { role: 'assistant', content: `${result.message} ${message}`.trim(), status: 'not-applied' },
          ]);
        }),
        catchError((error) => {
          const message = this.toErrorMessage(error, 'Failed to generate a workflow from that description.');
          this.generationError.set(message);
          this.authoringMessages.update((messages) => [
            ...messages,
            { role: 'assistant', content: message, status: 'not-applied' },
          ]);
          return EMPTY;
        }),
        finalize(() => this.isGenerating.set(false))
      )
      .subscribe();
  }

  resetToStarter() {
    if (this.isEditing()) {
      return;
    }

    this.draftStore.initializeFromStarter(DEFAULT_AGENT_STARTER_TEMPLATE, this.agentName().trim());
  }

  onTemplateVersionInput(version: string) {
    this.updateTemplate((template) => {
      template.template_version = version;
    });
  }

  onEntryNodeInput(entryNode: string) {
    this.updateTemplate((template) => {
      template.entry_node = entryNode;
    });
  }

  onMaxIterationsInput(raw: string) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return;
    }

    this.updateTemplate((template) => {
      template.guardrails.max_iterations = Math.floor(parsed);
    });
  }

  onBannedTopicsInput(raw: string) {
    const topics = raw
      .split(',')
      .map((topic) => topic.trim())
      .filter((topic) => topic.length > 0);

    this.updateTemplate((template) => {
      template.guardrails.banned_topics_override = topics.length > 0 ? topics : null;
    });
  }

  onJudgeOverrideInput(raw: string) {
    const nextValue = raw === 'null' ? null : raw === 'true';
    this.updateTemplate((template) => {
      template.guardrails.judge_enabled_override = nextValue;
    });
  }

  onNodeDescriptionInput(nodeId: string, value: string) {
    this.updateNode(nodeId, (node) => ({
      ...node,
      description: value,
    }));
  }

  onNodePromptInput(nodeId: string, value: string) {
    this.updateNode(nodeId, (node) => {
      switch (node.type) {
        case 'structured_parser':
          return node.config.strategy === 'llm'
            ? { ...node, config: { ...node.config, llm_prompt_instructions: value } }
            : node;
        case 'condition':
          return { ...node, config: { ...node.config, expression: value } };
        case 'user_interrupt':
          return { ...node, config: { ...node.config, prompt: value } };
        case 'llm_step':
          return { ...node, config: { ...node.config, system_prompt: value } };
        case 'terminal_response':
          return { ...node, config: { ...node.config, template: value } };
        case 'service_call':
          return node;
      }
    });
  }

  onNextNodeInput(nodeId: string, targetNodeId: string) {
    this.updateNode(nodeId, (node) => {
      if (node.type === 'condition' || node.type === 'terminal_response') {
        return node;
      }

      return { ...node, next: targetNodeId };
    });
  }

  onFailureNodeInput(nodeId: string, targetNodeId: string) {
    this.updateNode(nodeId, (node) => {
      if (node.type !== 'structured_parser' && node.type !== 'service_call' && node.type !== 'llm_step') {
        return node;
      }

      return { ...node, on_failure: targetNodeId || undefined };
    });
  }

  onConditionBranchTargetInput(nodeId: string, branchLabel: string, targetNodeId: string) {
    this.updateNode(nodeId, (node) => {
      if (node.type !== 'condition') {
        return node;
      }

      return {
        ...node,
        branches: {
          ...node.branches,
          [branchLabel]: targetNodeId,
        },
      };
    });
  }

  onGraphChanged(nextGraph: AgentTemplateGraph) {
    this.draftStore.setTemplateFromGraph(nextGraph);
  }

  onGraphLayoutChanged(layout: GraphLayoutState) {
    this.draftStore.setGraphLayout(layout);
  }

  nodeTypeLabel(node: AgentTemplateNode) {
    return this.paletteItems().find((item) => item.type === node.type)?.label ?? node.type;
  }

  nodeTypeIcon(node: AgentTemplateNode) {
    return this.paletteItems().find((item) => item.type === node.type)?.icon ?? ICON_BY_NODE_TYPE[node.type];
  }

  validateTemplate() {
    const name = this.agentName().trim();
    if (!name) {
      this.draftStore.setValidationFailure('Agent name is required before validation.');
      return;
    }

    this.draftStore.startValidation();
    this.saveError.set(null);

    this.agentService
      .validateAuthoringTemplate(this.template())
      .pipe(
        tap((result) => {
          if (result.normalized_template && isAgentTemplate(result.normalized_template)) {
            this.draftStore.setTemplate(result.normalized_template);
          }

          const issues = result.errors.map(
            (error): DraftValidationIssue => ({
              path: error.path,
              nodeId: error.node_id,
              message: error.message,
            })
          );
          this.draftStore.setValidationResult(result.is_valid, issues);
        }),
        catchError((error) => {
          this.draftStore.setValidationFailure(this.toErrorMessage(error, 'Failed to validate template.'));
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
    const parsedTemplate = this.template();

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
    const loadedTemplate = record.raw_template;
    if (!loadedTemplate || !isAgentTemplate(loadedTemplate)) {
      this.loadError.set('Loaded template payload is missing or invalid.');
      return;
    }

    this.draftStore.initializeFromExisting(record.name, record.version, loadedTemplate);
  }

  copyJsonPreview() {
    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard?.writeText) {
      this.exportMessage.set('Clipboard export is unavailable in this environment.');
      return;
    }

    void clipboard
      .writeText(this.draftJsonPreview())
      .then(() => this.exportMessage.set('Preview JSON copied to clipboard.'))
      .catch(() => this.exportMessage.set('Failed to copy preview JSON to clipboard.'));
  }

  nodeConfigJson(node: AgentTemplateNode) {
    return this.prettyJson(node.config);
  }

  nodeLayoutById(nodeId: string) {
    return this.graphLayout().nodeLayoutById[nodeId] ?? { x: 0, y: 0, selected: false };
  }

  branchEntries(node: AgentTemplateNode) {
    if (node.type !== 'condition') {
      return [];
    }

    return Object.entries(node.branches).map(([label, target]) => ({ label, target }));
  }

  branchConversationLabel(label: string, index: number) {
    if (label === 'default') {
      return 'Otherwise';
    }

    return index === 0 ? `Then, when ${label}` : `Or, when ${label}`;
  }

  private updateNode(nodeId: string, updater: (node: AgentTemplateNode) => AgentTemplateNode) {
    this.updateTemplate((template) => {
      template.nodes = template.nodes.map((node) => (node.id === nodeId ? updater(node) : node));
    });
  }

  private updateTemplate(mutator: (template: AgentTemplate) => void) {
    const nextTemplate = cloneTemplate(this.template());
    mutator(nextTemplate);
    this.draftStore.setTemplate(nextTemplate);
  }

  private loadAuthoringSchemaCatalog() {
    this.paletteLoading.set(true);
    this.paletteError.set(null);

    this.agentService
      .getAuthoringSchema()
      .pipe(
        tap((schema) => {
          this.paletteItems.set(this.toPaletteItems(schema));
        }),
        catchError((error) => {
          this.paletteItems.set(DEFAULT_PALETTE);
          this.paletteError.set(this.toErrorMessage(error, 'Failed to load component palette from schema catalog.'));
          return EMPTY;
        }),
        finalize(() => this.paletteLoading.set(false))
      )
      .subscribe();
  }

  private toPaletteItems(schema: AgentAuthoringSchemaResponse): AgentCanvasPaletteItem[] {
    const byType = new Map(
      schema.node_types
        .filter((nodeType) => isAgentNodeType(nodeType.type))
        .map((nodeType) => [nodeType.type, nodeType])
    );

    return SUPPORTED_NODE_TYPES.map((type) => {
      const schemaNode = byType.get(type);
      if (!schemaNode) {
        return DEFAULT_PALETTE.find((item) => item.type === type) as AgentCanvasPaletteItem;
      }

      return {
        type,
        label: schemaNode.label,
        icon: ICON_BY_NODE_TYPE[type],
        description: schemaNode.description,
      };
    });
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

function isAgentNodeType(value: string): value is AgentNodeType {
  return SUPPORTED_NODE_TYPES.includes(value as AgentNodeType);
}
