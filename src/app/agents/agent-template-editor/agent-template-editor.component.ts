import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { EMPTY, catchError, finalize, tap } from 'rxjs';
import { AgentService, AgentTemplateRecord } from '../agent.service';
import { AgentTemplate, AgentTemplateNode, cloneTemplate, isAgentTemplate } from '../agent-template.models';
import {
  AgentTemplateDraftStore,
  DEFAULT_AGENT_STARTER_TEMPLATE,
  DraftValidationIssue,
} from './agent-template-draft.store';

type EditorMode = 'natural-language' | 'visual-graph' | 'advanced-json';

@Component({
  selector: 'app-agent-template-editor',
  templateUrl: './agent-template-editor.component.html',
  styleUrl: './agent-template-editor.component.css',
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
  readonly nodeConfigErrors = signal<Record<string, string>>({});
  readonly graphEditError = signal<string | null>(null);
  readonly exportMessage = signal<string | null>(null);

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
    this.updateNode(nodeId, (node) => {
      const next = cloneNode(node);
      next.description = value;
      return next;
    });
  }

  onNodeIdInput(currentNodeId: string, proposedNodeId: string) {
    const nextNodeId = proposedNodeId.trim();
    if (!nextNodeId || nextNodeId === currentNodeId) {
      return;
    }

    if (this.nodeIds().includes(nextNodeId)) {
      this.graphEditError.set(`Node id '${nextNodeId}' already exists.`);
      return;
    }

    this.graphEditError.set(null);
    this.draftStore.renameGraphLayoutNode(currentNodeId, nextNodeId);

    this.updateTemplate((template) => {
      template.entry_node = template.entry_node === currentNodeId ? nextNodeId : template.entry_node;
      template.nodes = template.nodes.map((node) => {
        const renamedNode = node.id === currentNodeId ? { ...node, id: nextNodeId } : node;
        return replaceNodeReferences(renamedNode, currentNodeId, nextNodeId);
      });
    });
  }

  onNodeCoordinateInput(nodeId: string, axis: 'x' | 'y', raw: string) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return;
    }

    this.draftStore.updateGraphLayoutForNode(nodeId, {
      [axis]: parsed,
    });
  }

  onNodeSelected(nodeId: string) {
    this.draftStore.selectGraphNode(nodeId);
  }

  onNodeConfigInput(nodeId: string, rawJson: string) {
    try {
      const parsed = JSON.parse(rawJson) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        this.setNodeConfigError(nodeId, 'Node config must be a JSON object.');
        return;
      }

      this.clearNodeConfigError(nodeId);
      this.updateNode(nodeId, (node) => {
        const next = cloneNode(node);
        next.config = parsed as typeof next.config;
        return next;
      });
    } catch {
      this.setNodeConfigError(nodeId, 'Node config JSON is invalid.');
    }
  }

  onNodeNextInput(nodeId: string, nextNodeId: string) {
    if (!nextNodeId.trim()) {
      return;
    }

    this.updateNode(nodeId, (node) => {
      if (!supportsNext(node)) {
        return node;
      }

      const next = cloneNode(node);
      next.next = nextNodeId;
      return next;
    });
  }

  onNodeFailureInput(nodeId: string, failureNodeId: string) {
    this.updateNode(nodeId, (node) => {
      if (!supportsFailure(node)) {
        return node;
      }

      const next = cloneNode(node);
      next.on_failure = failureNodeId.trim() ? failureNodeId : undefined;
      return next;
    });
  }

  addConditionBranch(nodeId: string) {
    this.updateNode(nodeId, (node) => {
      if (node.type !== 'condition') {
        return node;
      }

      let branchIndex = 1;
      let branchName = `branch_${branchIndex}`;
      while (branchName in node.branches) {
        branchIndex += 1;
        branchName = `branch_${branchIndex}`;
      }

      return {
        ...node,
        branches: {
          ...node.branches,
          [branchName]: node.branches['default'],
        },
      };
    });
  }

  removeConditionBranch(nodeId: string, branchLabel: string) {
    if (branchLabel === 'default') {
      return;
    }

    this.updateNode(nodeId, (node) => {
      if (node.type !== 'condition') {
        return node;
      }

      const branches = { ...node.branches };
      delete branches[branchLabel];
      return {
        ...node,
        branches,
      };
    });
  }

  onConditionBranchNameInput(nodeId: string, branchLabel: string, proposedLabel: string) {
    const nextLabel = proposedLabel.trim();
    if (!nextLabel || nextLabel === branchLabel) {
      return;
    }

    this.updateNode(nodeId, (node) => {
      if (node.type !== 'condition') {
        return node;
      }

      if (nextLabel in node.branches) {
        this.graphEditError.set(`Branch '${nextLabel}' already exists on node '${nodeId}'.`);
        return node;
      }

      const branchTarget = node.branches[branchLabel];
      const updated: Record<string, string> = {};
      for (const [label, target] of Object.entries(node.branches)) {
        if (label === branchLabel) {
          updated[nextLabel] = branchTarget;
          continue;
        }
        updated[label] = target;
      }

      this.graphEditError.set(null);
      return {
        ...node,
        branches: updated,
      };
    });
  }

  onConditionBranchTargetInput(nodeId: string, branchLabel: string, targetNodeId: string) {
    if (!targetNodeId.trim()) {
      return;
    }

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

  private setNodeConfigError(nodeId: string, message: string) {
    this.nodeConfigErrors.update((state) => ({
      ...state,
      [nodeId]: message,
    }));
  }

  private clearNodeConfigError(nodeId: string) {
    this.nodeConfigErrors.update((state) => {
      const next = { ...state };
      delete next[nodeId];
      return next;
    });
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
    this.graphEditError.set(null);
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

function supportsNext(
  node: AgentTemplateNode
): node is Exclude<AgentTemplateNode, { type: 'condition' } | { type: 'terminal_response' }> {
  return node.type !== 'condition' && node.type !== 'terminal_response';
}

function supportsFailure(node: AgentTemplateNode): node is Extract<AgentTemplateNode, { on_failure?: string | null }> {
  return node.type === 'structured_parser' || node.type === 'service_call' || node.type === 'llm_step';
}

function replaceNodeReferences(node: AgentTemplateNode, currentNodeId: string, nextNodeId: string): AgentTemplateNode {
  if (node.type === 'condition') {
    const remappedBranches = Object.fromEntries(
      Object.entries(node.branches).map(([label, target]) => [label, target === currentNodeId ? nextNodeId : target])
    );
    return {
      ...node,
      branches: remappedBranches,
    };
  }

  if (node.type === 'terminal_response') {
    return node;
  }

  const withNext = {
    ...node,
    next: node.next === currentNodeId ? nextNodeId : node.next,
  };

  if (!supportsFailure(withNext)) {
    return withNext;
  }

  return {
    ...withNext,
    on_failure: withNext.on_failure === currentNodeId ? nextNodeId : withNext.on_failure,
  };
}

function cloneNode<T extends AgentTemplateNode>(node: T): T {
  return JSON.parse(JSON.stringify(node)) as T;
}
