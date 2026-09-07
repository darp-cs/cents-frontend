import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { EMPTY, catchError, finalize, tap } from 'rxjs';
import { AgentAuthoringSchemaResponse, AgentService, AgentTemplateRecord } from '../agent.service';
import { AgentNodeType, AgentTemplate, AgentTemplateNode, cloneTemplate, isAgentTemplate } from '../agent-template.models';
import { AgentTemplateGraph } from '../agent-template-graph.adapters';
import { ToolService } from '../../tools/tool.service';
import {
  AgentTemplateDraftStore,
  DEFAULT_AGENT_STARTER_TEMPLATE,
  DraftValidationIssue,
  GraphLayoutState,
  SUB_AGENT_EXAMPLES,
  SubAgentExample,
} from './agent-template-draft.store';
import { AgentCanvasPaletteItem, AgentWorkflowCanvasComponent } from './agent-workflow-canvas.component';

type EditorMode = 'natural-language' | 'visual-graph' | 'advanced-json';

const SUPPORTED_NODE_TYPES: AgentNodeType[] = [
  'structured_parser',
  'condition',
  'service_call',
  'user_interrupt',
  'llm_step',
  'terminal_response',
];

const DISPLAY_LABEL_BY_TYPE: Record<AgentNodeType, string> = {
  structured_parser: 'Parse',
  condition: 'Decision',
  service_call: 'Action',
  user_interrupt: 'Interrupt',
  llm_step: 'Think',
  terminal_response: 'Reply',
};

const DEFAULT_PALETTE: AgentCanvasPaletteItem[] = [
  {
    type: 'structured_parser',
    label: DISPLAY_LABEL_BY_TYPE.structured_parser,
    icon: 'SP',
    description: 'Parse key fields from incoming text.',
  },
  {
    type: 'condition',
    label: DISPLAY_LABEL_BY_TYPE.condition,
    icon: '?',
    description: 'Choose a route using a true/false expression.',
  },
  {
    type: 'service_call',
    label: DISPLAY_LABEL_BY_TYPE.service_call,
    icon: 'API',
    description: 'Call an API or tool and store the result.',
  },
  {
    type: 'user_interrupt',
    label: DISPLAY_LABEL_BY_TYPE.user_interrupt,
    icon: 'USR',
    description: 'Pause and ask the user for input.',
  },
  {
    type: 'llm_step',
    label: DISPLAY_LABEL_BY_TYPE.llm_step,
    icon: 'LLM',
    description: 'Generate reasoning text from workflow state.',
  },
  {
    type: 'terminal_response',
    label: DISPLAY_LABEL_BY_TYPE.terminal_response,
    icon: 'END',
    description: 'Return the final response for this route.',
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

@Component({
  selector: 'app-agent-template-editor',
  templateUrl: './agent-template-editor.component.html',
  styleUrl: './agent-template-editor.component.css',
  imports: [AgentWorkflowCanvasComponent],
  providers: [AgentTemplateDraftStore],
})
export class AgentTemplateEditorComponent {
  private readonly agentService = inject(AgentService);
  private readonly toolService = inject(ToolService);
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
  readonly toolsLoading = signal(true);
  readonly toolsError = signal<string | null>(null);
  readonly availableTools = signal<Array<{ id: string; name: string }>>([]);
  readonly authoringPrompt = signal('');
  readonly isGenerating = signal(false);
  readonly generationError = signal<string | null>(null);
  readonly generationMessage = signal<string | null>(null);
  readonly assistingNodeId = signal<string | null>(null);
  readonly nodeAssistError = signal<string | null>(null);
  readonly workflowSourcePlaceholder = [
    'Credit Recommendations',
    '',
    '@if the user is authenticated',
    '  do this',
    '@else',
    '  do this',
    '',
    '@interrupt the user to clarify if more information is needed',
  ].join('\n');
  readonly examples = SUB_AGENT_EXAMPLES;
  readonly selectedExampleId = signal(SUB_AGENT_EXAMPLES[0]?.id ?? '');

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
  readonly selectedExample = computed<SubAgentExample | null>(
    () => this.examples.find((example) => example.id === this.selectedExampleId()) ?? null
  );
  readonly graphEquivalentSource = computed(() =>
    renderWorkflowSourceFromTemplate(
      this.template(),
      this.agentName().trim() || this.selectedExample()?.name || 'Workflow'
    )
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
    this.loadEnabledTools();

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
    this.generationMessage.set(null);
  }

  generateFromDescription() {
    const prompt = this.authoringPrompt().trim();
    if (!prompt || this.isGenerating()) {
      return;
    }

    this.generationError.set(null);
    this.generationMessage.set(null);
    this.isGenerating.set(true);

    this.agentService
      .generateAuthoringTemplate(prompt, null)
      .pipe(
        tap((result) => {
          const generatedTemplate = result.generated_template;
          if (result.is_valid && generatedTemplate && isAgentTemplate(generatedTemplate)) {
            this.draftStore.setTemplate(generatedTemplate, { layoutPreference: 'template-first' });
            this.draftStore.setValidationResult(true, []);
            this.generationMessage.set(result.message);
            return;
          }

          const details = result.errors.map((error) => error.message).join(' ');
          const message = details || 'The generated workflow did not pass validation, so your current draft was kept.';
          this.generationError.set(message);
        }),
        catchError((error) => {
          const message = this.toErrorMessage(error, 'Failed to generate a workflow from that description.');
          this.generationError.set(message);
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
    this.syncAuthoringPromptFromTemplate(this.template(), this.agentName().trim() || 'Starter workflow');
  }

  onExampleSelectionInput(exampleId: string) {
    this.selectedExampleId.set(exampleId);
  }

  applySelectedExample() {
    const selectedExample = this.selectedExample();
    if (!selectedExample || this.isBootstrapping() || this.isSaving()) {
      return;
    }

    this.draftStore.setTemplate(selectedExample.template, { layoutPreference: 'template-first' });
    this.syncAuthoringPromptFromTemplate(selectedExample.template, selectedExample.name);
    this.generationError.set(null);
    this.generationMessage.set(`Loaded example: ${selectedExample.name}.`);

    if (!this.isEditing() && !this.agentName().trim()) {
      this.draftStore.setAgentName(selectedExample.name);
    }
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
    this.nodeAssistError.set(null);
    this.draftStore.setTemplateFromGraph(nextGraph);
    this.syncAuthoringPromptFromTemplate(this.template(), this.agentName().trim() || 'Workflow');
  }

  onGraphLayoutChanged(layout: GraphLayoutState) {
    this.draftStore.setGraphLayout(layout);
  }

  onNodeAssistRequested(request: { nodeId: string; instruction: string }) {
    if (this.assistingNodeId() !== null || this.isBootstrapping() || this.isSaving()) {
      return;
    }

    const node = this.template().nodes.find((candidate) => candidate.id === request.nodeId);
    if (!node) {
      this.nodeAssistError.set(`Could not find node '${request.nodeId}' to update.`);
      return;
    }

    this.assistingNodeId.set(request.nodeId);
    this.nodeAssistError.set(null);

    this.agentService
      .assistAuthoringNode({
        node_type: node.type,
        instruction: request.instruction,
        current_node: node,
        current_template: this.template(),
      })
      .pipe(
        tap((result) => {
          const assistedNode = result.node;
          if (result.is_valid && isAgentTemplateNode(assistedNode)) {
            this.updateNode(request.nodeId, () => assistedNode);
            this.generationMessage.set(`Updated ${request.nodeId} from natural language instruction.`);
            this.generationError.set(null);
            return;
          }

          const details = result.errors.map((error) => error.message).join(' ');
          this.nodeAssistError.set(details || 'AI draft could not be applied for this node.');
        }),
        catchError((error) => {
          this.nodeAssistError.set(this.toErrorMessage(error, 'Failed to generate a node draft from that instruction.'));
          return EMPTY;
        }),
        finalize(() => this.assistingNodeId.set(null))
      )
      .subscribe();
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

    const persistableTemplate = this.draftStore.templateForPersistence();

    this.agentService
      .validateAuthoringTemplate(persistableTemplate)
      .pipe(
        tap((result) => {
          if (result.normalized_template && isAgentTemplate(result.normalized_template)) {
            this.draftStore.setTemplate(result.normalized_template, { layoutPreference: 'template-first' });
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
    const parsedTemplate = this.draftStore.templateForPersistence();

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
    this.syncAuthoringPromptFromTemplate(loadedTemplate, record.name);
  }

  private syncAuthoringPromptFromTemplate(template: AgentTemplate, fallbackTitle: string) {
    this.authoringPrompt.set(renderWorkflowSourceFromTemplate(template, fallbackTitle));
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

  private loadEnabledTools() {
    this.toolsLoading.set(true);
    this.toolsError.set(null);

    this.toolService
      .listTools(true)
      .pipe(
        tap((tools) => {
          this.availableTools.set(
            tools
              .map((tool) => ({ id: tool.id, name: tool.name }))
              .filter((tool) => tool.name.trim().length > 0)
              .sort((left, right) => left.name.localeCompare(right.name))
          );
        }),
        catchError((error) => {
          this.availableTools.set([]);
          this.toolsError.set(this.toErrorMessage(error, 'Failed to load enabled tools for Action nodes.'));
          return EMPTY;
        }),
        finalize(() => this.toolsLoading.set(false))
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
        label: DISPLAY_LABEL_BY_TYPE[type],
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

function isAgentTemplateNode(value: unknown): value is AgentTemplateNode {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['id'] === 'string' &&
    typeof candidate['type'] === 'string' &&
    typeof candidate['config'] === 'object' &&
    candidate['config'] !== null &&
    !Array.isArray(candidate['config'])
  );
}

function renderWorkflowSourceFromTemplate(template: AgentTemplate, workflowTitle: string): string {
  const title = workflowTitle.trim() || 'Workflow';
  const lines: string[] = [title, '', `@start ${template.entry_node}`, ''];

  for (const node of template.nodes) {
    lines.push(...renderNodeDirectiveLines(node));
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function renderNodeDirectiveLines(node: AgentTemplateNode): string[] {
  const details = normalizeNodeNarrative(node.description);

  if (node.type === 'structured_parser') {
    const fields = node.config.fields.map((field) => field.name).join(', ') || 'structured fields';
    return [
      `@listen [${node.id}] ${details || `extract ${fields}`}`,
      `  @next ${node.next}`,
      ...(node.on_failure ? [`  @on_failure ${node.on_failure}`] : []),
    ];
  }

  if (node.type === 'condition') {
    const entries = Object.entries(node.branches);
    const prioritized = [
      ...entries.filter(([label]) => label !== 'default').sort(([left], [right]) => left.localeCompare(right)),
      ...entries.filter(([label]) => label === 'default'),
    ];
    return [
      `@if [${node.id}] ${node.config.expression}`,
      ...prioritized.map(([label, target]) => (label === 'default' ? `  @else ${target}` : `  @branch ${label} ${target}`)),
    ];
  }

  if (node.type === 'service_call') {
    const callSummary =
      node.config.mode === 'tool'
        ? `use tool ${node.config.tool_name ?? node.config.tool_id ?? '(select tool)'} with input ${JSON.stringify(node.config.tool_input_template ?? {})}`
        : `send ${node.config.method} ${node.config.url ?? '(set service URL)'}`;
    const toolMeta =
      node.config.mode === 'tool' && node.config.tool_id
        ? ` (tool_id=${node.config.tool_id})`
        : '';
    const instruction = details ? `${details} (${callSummary}${toolMeta})` : `${callSummary}${toolMeta}`;
    return [
      `@call [${node.id}] ${instruction}`,
      `  @next ${node.next}`,
      ...(node.on_failure ? [`  @on_failure ${node.on_failure}`] : []),
    ];
  }

  if (node.type === 'user_interrupt') {
    return [`@interrupt [${node.id}] ${details || node.config.prompt}`, `  @next ${node.next}`];
  }

  if (node.type === 'llm_step') {
    return [
      `@think [${node.id}] ${details || node.config.system_prompt}`,
      `  @next ${node.next}`,
      ...(node.on_failure ? [`  @on_failure ${node.on_failure}`] : []),
    ];
  }

  return [`@reply [${node.id}] ${details || node.config.template}`];
}

function normalizeNodeNarrative(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : '';
}
