import { Component, EventEmitter, Input, NgZone, Output, ViewChild, inject, signal } from '@angular/core';
import {
  FCanvasChangeEvent,
  FCanvasComponent,
  FCreateConnectionEvent,
  FDeleteSelectedEvent,
  FFlowModule,
  FMoveNodesEvent,
  FReassignConnectionEvent,
  FSelectionChangeEvent,
  provideFFlow,
  withA11y,
  withConnectionFlow,
} from '@foblex/flow';
import { AgentNodeType } from '../agent-template.models';
import { AgentGraphEdge, AgentGraphNode, AgentTemplateGraph } from '../agent-template-graph.adapters';
import { GraphLayoutState, GraphNodeLayout } from './agent-template-draft.store';

export interface AgentCanvasPaletteItem {
  type: AgentNodeType;
  label: string;
  icon: string;
  description: string;
}

export interface AgentCanvasToolOption {
  id: string;
  name: string;
}

interface NodeViewModel {
  id: string;
  type: AgentNodeType;
  label: string;
  icon: string;
  description: string;
  position: { x: number; y: number };
  isEntry: boolean;
  supportsFailure: boolean;
  supportsNext: boolean;
}

interface ConnectionViewModel {
  id: string;
  kind: AgentGraphEdge['kind'];
  label: string;
  displayLabel: string;
  color: string;
  sourceNodeId: string;
  targetNodeId: string;
  branchLabel: string | null;
  isSelected: boolean;
  sourceConnectorId: string;
  targetConnectorId: string;
}

interface SourceConnectorParts {
  sourceNodeId: string;
  kind: AgentGraphEdge['kind'];
  branchLabel?: string;
}

type ServiceCallMode = 'http' | 'tool';
type ServiceCallMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const FALLBACK_LABELS: Record<AgentNodeType, string> = {
  structured_parser: 'Parse',
  condition: 'Decision',
  service_call: 'Action',
  user_interrupt: 'Interrupt',
  llm_step: 'Think',
  terminal_response: 'Reply',
};

const FALLBACK_ICONS: Record<AgentNodeType, string> = {
  structured_parser: 'SP',
  condition: '?',
  service_call: 'API',
  user_interrupt: 'USR',
  llm_step: 'LLM',
  terminal_response: 'END',
};

const NODE_ID_PREFIX_BY_TYPE: Record<AgentNodeType, string> = {
  structured_parser: 'parse',
  condition: 'decision',
  service_call: 'action',
  user_interrupt: 'interrupt',
  llm_step: 'think',
  terminal_response: 'reply',
};

@Component({
  selector: 'app-agent-workflow-canvas',
  standalone: true,
  imports: [FFlowModule],
  templateUrl: './agent-workflow-canvas.component.html',
  styleUrl: './agent-workflow-canvas.component.css',
  providers: [provideFFlow(withA11y(), withConnectionFlow('drag'))],
})
export class AgentWorkflowCanvasComponent {
  private readonly zone = inject(NgZone);

  @Input({ required: true }) graph!: AgentTemplateGraph;
  @Input({ required: true }) layout!: GraphLayoutState;
  @Input() palette: AgentCanvasPaletteItem[] = [];
  @Input() availableTools: AgentCanvasToolOption[] = [];
  @Input() toolsLoading = false;
  @Input() toolsError: string | null = null;
  @Input() paletteLoading = false;
  @Input() paletteError: string | null = null;
  @Input() disabled = false;
  @Input() assistingNodeId: string | null = null;
  @Input() nodeAssistError: string | null = null;

  @Output() graphChange = new EventEmitter<AgentTemplateGraph>();
  @Output() layoutChange = new EventEmitter<GraphLayoutState>();
  @Output() nodeAssistRequested = new EventEmitter<{ nodeId: string; instruction: string }>();

  @ViewChild('canvas') private canvas?: FCanvasComponent;

  readonly selectedNodeIds = signal<string[]>([]);
  readonly selectedConnectionIds = signal<string[]>([]);
  readonly selectedNodeId = signal<string | null>(null);
  readonly inspectedConnectionId = signal<string | null>(null);
  readonly componentPickerOpen = signal(false);
  readonly connectionError = signal<string | null>(null);
  readonly nodeAssistDraftById = signal<Record<string, string>>({});
  readonly nodeAssistLocalError = signal<string | null>(null);
  readonly nodeConfigError = signal<string | null>(null);

  nodeViews(): NodeViewModel[] {
    return this.graph.nodes.map((node) => {
      const paletteRecord = this.palette.find((item) => item.type === node.type);
      const nodeLayout = this.layout.nodeLayoutById[node.id] ?? this.defaultNodeLayout();
      return {
        id: node.id,
        type: node.type,
        label: paletteRecord?.label ?? FALLBACK_LABELS[node.type],
        icon: paletteRecord?.icon ?? FALLBACK_ICONS[node.type],
        description: node.description ?? '',
        position: { x: nodeLayout.x, y: nodeLayout.y },
        isEntry: this.graph.entryNodeId === node.id,
        supportsFailure: this.supportsFailureEdge(node.type),
        supportsNext: this.supportsNextEdge(node.type),
      };
    });
  }

  connectionViews(): ConnectionViewModel[] {
    const selectedIds = new Set(this.selectedConnectionIds());
    return this.graph.edges.map((edge) => ({
      id: edge.id,
      kind: edge.kind,
      label: this.edgeLabel(edge),
      displayLabel: this.edgeDisplayLabel(edge),
      color: this.edgeColor(edge.kind),
      sourceNodeId: edge.source,
      targetNodeId: edge.target,
      branchLabel: edge.branchLabel ?? null,
      isSelected: selectedIds.has(edge.id),
      sourceConnectorId: this.sourceConnectorId(edge),
      targetConnectorId: this.targetConnectorId(edge.target),
    }));
  }

  selectedNode() {
    const nodeId = this.selectedNodeId();
    return nodeId ? (this.graph.nodes.find((node) => node.id === nodeId) ?? null) : null;
  }

  inspectedConnection() {
    const connectionId = this.inspectedConnectionId();
    return connectionId ? this.connectionViews().find((connection) => connection.id === connectionId) ?? null : null;
  }

  outgoingConnections(nodeId: string) {
    return this.connectionViews().filter((connection) => connection.sourceNodeId === nodeId);
  }

  toggleComponentPicker() {
    this.componentPickerOpen.update((open) => !open);
  }

  openNodeEditor(nodeId: string) {
    this.inspectedConnectionId.set(null);
    this.selectedNodeId.set(nodeId);
    this.selectedNodeIds.set([nodeId]);
    this.componentPickerOpen.set(false);
    this.nodeConfigError.set(null);
  }

  openConnectionEditor(connectionId: string) {
    this.selectedNodeId.set(null);
    this.selectedNodeIds.set([]);
    this.selectedConnectionIds.set([connectionId]);
    this.inspectedConnectionId.set(connectionId);
    this.componentPickerOpen.set(false);
  }

  closeNodeEditor() {
    this.selectedNodeId.set(null);
    this.selectedNodeIds.set([]);
    this.nodeConfigError.set(null);
  }

  closeConnectionEditor() {
    this.inspectedConnectionId.set(null);
    this.selectedConnectionIds.set([]);
    this.nodeConfigError.set(null);
  }

  nodeTypeLabel(type: AgentNodeType) {
    const paletteRecord = this.palette.find((item) => item.type === type);
    return paletteRecord?.label ?? FALLBACK_LABELS[type];
  }

  updateNodeDescription(nodeId: string, description: string) {
    this.updateGraphNode(nodeId, (node) => ({ ...node, description }));
  }

  updateNodeEditableText(nodeId: string, value: string) {
    this.updateGraphNode(nodeId, (node) => {
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

  updateParserStrategy(nodeId: string, strategy: string) {
    if (strategy !== 'regex' && strategy !== 'llm') {
      return;
    }

    this.updateGraphNode(nodeId, (node) =>
      node.type === 'structured_parser' ? { ...node, config: { ...node.config, strategy } } : node
    );
  }

  updateServiceUrl(nodeId: string, url: string) {
    this.nodeConfigError.set(null);
    this.updateGraphNode(nodeId, (node) =>
      node.type === 'service_call' ? { ...node, config: { ...node.config, url } } : node
    );
  }

  updateServiceMode(nodeId: string, mode: string) {
    if (mode !== 'http' && mode !== 'tool') {
      return;
    }

    this.nodeConfigError.set(null);
    this.updateGraphNode(nodeId, (node) => {
      if (node.type !== 'service_call') {
        return node;
      }

      if (mode === 'tool') {
        return {
          ...node,
          config: {
            ...node.config,
            mode,
            url: null,
            tool_name: node.config.tool_name ?? null,
            tool_id: node.config.tool_id ?? null,
            tool_input_template: node.config.tool_input_template ?? {},
          },
        };
      }

      return {
        ...node,
        config: {
          ...node.config,
          mode,
          url: node.config.url ?? 'https://api.example.com/service',
          tool_name: null,
          tool_id: null,
          body_template: node.config.body_template ?? {},
        },
      };
    });
  }

  updateServiceMethod(nodeId: string, method: string) {
    if (method !== 'GET' && method !== 'POST' && method !== 'PUT' && method !== 'PATCH' && method !== 'DELETE') {
      return;
    }

    this.nodeConfigError.set(null);
    this.updateGraphNode(nodeId, (node) =>
      node.type === 'service_call' ? { ...node, config: { ...node.config, method: method as ServiceCallMethod } } : node
    );
  }

  updateServiceToolName(nodeId: string, toolName: string) {
    this.nodeConfigError.set(null);
    const normalized = toolName.trim();
    this.updateGraphNode(nodeId, (node) =>
      node.type === 'service_call' ? { ...node, config: { ...node.config, tool_name: normalized || null } } : node
    );
  }

  updateServiceToolId(nodeId: string, toolId: string) {
    this.nodeConfigError.set(null);
    const normalized = toolId.trim();
    this.updateGraphNode(nodeId, (node) =>
      node.type === 'service_call' ? { ...node, config: { ...node.config, tool_id: normalized || null } } : node
    );
  }

  updateServiceTimeout(nodeId: string, rawValue: string) {
    this.nodeConfigError.set(null);
    const normalized = rawValue.trim();
    if (!normalized) {
      this.updateGraphNode(nodeId, (node) =>
        node.type === 'service_call' ? { ...node, config: { ...node.config, timeout_seconds: null } } : node
      );
      return;
    }

    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed < 1) {
      this.nodeConfigError.set('Timeout must be a positive number of seconds.');
      return;
    }

    this.updateGraphNode(nodeId, (node) =>
      node.type === 'service_call'
        ? { ...node, config: { ...node.config, timeout_seconds: Math.floor(parsed) } }
        : node
    );
  }

  updateServiceAllowUnsafe(nodeId: string, allowUnsafe: boolean) {
    this.nodeConfigError.set(null);
    this.updateGraphNode(nodeId, (node) =>
      node.type === 'service_call' ? { ...node, config: { ...node.config, allow_unsafe_destination: allowUnsafe } } : node
    );
  }

  updateServiceHeadersTemplate(nodeId: string, rawValue: string) {
    const parsed = this.parseJsonStringMap(rawValue, 'Headers template must be a JSON object with string values.');
    if (!parsed) {
      return;
    }

    this.nodeConfigError.set(null);
    this.updateGraphNode(nodeId, (node) =>
      node.type === 'service_call' ? { ...node, config: { ...node.config, headers_template: parsed } } : node
    );
  }

  updateServiceBodyTemplate(nodeId: string, rawValue: string) {
    const parsed = this.parseJsonObjectOrNull(rawValue, 'Body template must be a JSON object or null.');
    if (parsed === undefined) {
      return;
    }

    this.nodeConfigError.set(null);
    this.updateGraphNode(nodeId, (node) =>
      node.type === 'service_call' ? { ...node, config: { ...node.config, body_template: parsed } } : node
    );
  }

  updateServiceToolInputTemplate(nodeId: string, rawValue: string) {
    const parsed = this.parseJsonObject(rawValue, 'Tool input template must be a JSON object.');
    if (!parsed) {
      return;
    }

    this.nodeConfigError.set(null);
    this.updateGraphNode(nodeId, (node) =>
      node.type === 'service_call' ? { ...node, config: { ...node.config, tool_input_template: parsed } } : node
    );
  }

  serviceHeadersTemplateText(nodeId: string): string {
    const serviceNode = this.findServiceCallNode(nodeId);
    return JSON.stringify(serviceNode?.config.headers_template ?? {}, null, 2);
  }

  serviceBodyTemplateText(nodeId: string): string {
    const serviceNode = this.findServiceCallNode(nodeId);
    const value = serviceNode?.config.body_template ?? {};
    return JSON.stringify(value, null, 2);
  }

  serviceToolInputTemplateText(nodeId: string): string {
    const serviceNode = this.findServiceCallNode(nodeId);
    return JSON.stringify(serviceNode?.config.tool_input_template ?? {}, null, 2);
  }

  serviceModeOptions(): ServiceCallMode[] {
    return ['http', 'tool'];
  }

  serviceMethodOptions(): ServiceCallMethod[] {
    return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  }

  toolOptionsForNode(nodeId: string): AgentCanvasToolOption[] {
    const normalizedTools = this.availableTools
      .map((tool) => ({
        id: tool.id,
        name: tool.name.trim(),
      }))
      .filter((tool) => tool.name.length > 0)
      .sort((left, right) => left.name.localeCompare(right.name));

    const serviceNode = this.findServiceCallNode(nodeId);
    const configuredName = serviceNode?.config.tool_name?.trim() ?? '';
    if (!configuredName) {
      return normalizedTools;
    }

    if (normalizedTools.some((tool) => tool.name === configuredName)) {
      return normalizedTools;
    }

    return [
      {
        id: `configured:${configuredName}`,
        name: configuredName,
      },
      ...normalizedTools,
    ];
  }

  nodeAssistDraft(nodeId: string) {
    return this.nodeAssistDraftById()[nodeId] ?? '';
  }

  updateNodeAssistDraft(nodeId: string, value: string) {
    this.nodeAssistLocalError.set(null);
    this.nodeAssistDraftById.update((state) => ({
      ...state,
      [nodeId]: value,
    }));
  }

  requestNodeAssist(nodeId: string) {
    if (this.disabled || this.assistingNodeId !== null) {
      return;
    }

    const instruction = this.nodeAssistDraft(nodeId).trim();
    if (!instruction) {
      this.nodeAssistLocalError.set('Describe what to change before applying AI draft.');
      return;
    }

    this.nodeAssistLocalError.set(null);
    this.nodeAssistRequested.emit({ nodeId, instruction });
  }

  updateBranchLabel(connectionId: string, label: string) {
    const edge = this.graph.edges.find((candidate) => candidate.id === connectionId);
    const proposedLabel = label.trim();
    if (!edge || edge.kind !== 'branch' || !proposedLabel || this.disabled) {
      this.connectionError.set('Branch labels cannot be empty.');
      return;
    }

    const collides = this.graph.edges.some(
      (candidate) =>
        candidate.id !== edge.id &&
        candidate.source === edge.source &&
        candidate.kind === 'branch' &&
        (candidate.branchLabel ?? 'default') === proposedLabel
    );
    if (collides) {
      this.connectionError.set(`Branch '${proposedLabel}' already exists for node '${edge.source}'.`);
      return;
    }

    this.connectionError.set(null);
    this.replaceEdgeSemantics(
      edge.id,
      { sourceNodeId: edge.source, kind: 'branch', branchLabel: proposedLabel },
      edge.target,
      true,
      false
    );
  }

  updateConnectionTarget(connectionId: string, targetNodeId: string) {
    const edge = this.graph.edges.find((candidate) => candidate.id === connectionId);
    if (!edge || !targetNodeId || this.disabled) {
      return;
    }

    this.replaceEdgeSemantics(
      edge.id,
      { sourceNodeId: edge.source, kind: edge.kind, branchLabel: edge.branchLabel },
      targetNodeId,
      true,
      false
    );
  }

  deleteEdgeById(connectionId: string) {
    this.removeEdgesByIds([connectionId]);
  }

  targetNodeOptions() {
    return this.graph.nodes.map((node) => ({ id: node.id, label: `${node.id} (${FALLBACK_LABELS[node.type]})` }));
  }

  conditionBranchOutputs(nodeId: string) {
    const branchLabels = this.graph.edges
      .filter((edge) => edge.source === nodeId && edge.kind === 'branch')
      .map((edge) => edge.branchLabel)
      .filter((label): label is string => typeof label === 'string' && label.trim().length > 0);

    const unique = branchLabels.length > 0 ? Array.from(new Set(branchLabels)) : ['default'];
    return unique.map((label) => ({
      label,
      connectorId: this.branchConnectorId(nodeId, label),
    }));
  }

  addNodeFromPalette(item: AgentCanvasPaletteItem) {
    if (this.disabled) {
      return;
    }

    const nextNodeId = this.uniqueNodeId(item.type);
    const fallbackTarget = this.graph.entryNodeId || this.graph.nodes[0]?.id || nextNodeId;
    const createdNode = this.createGraphNode(item.type, nextNodeId, item.description);

    const nextEdges = [...this.graph.edges];
    if (this.supportsNextEdge(item.type)) {
      nextEdges.push(this.createEdge('next', nextNodeId, fallbackTarget));
    }

    if (item.type === 'condition') {
      nextEdges.push(this.createEdge('branch', nextNodeId, fallbackTarget, 'default'));
    }

    const nextGraph: AgentTemplateGraph = {
      ...this.graph,
      entryNodeId: this.graph.nodes.length === 0 ? nextNodeId : this.graph.entryNodeId,
      nodes: [...this.graph.nodes, createdNode],
      edges: nextEdges,
    };

    const nextLayout = this.withNodeLayout(nextNodeId, this.nextPlacement(), true);
    this.selectedNodeId.set(nextNodeId);
    this.selectedNodeIds.set([nextNodeId]);
    this.componentPickerOpen.set(false);
    this.emitLayout(nextLayout);
    this.emitGraph(nextGraph);
  }

  duplicateNode(nodeId: string) {
    const sourceNode = this.graph.nodes.find((node) => node.id === nodeId);
    if (!sourceNode || this.disabled) {
      return;
    }

    const nextNodeId = this.uniqueNodeId(sourceNode.type);
    const cloneNode: AgentGraphNode = {
      ...JSON.parse(JSON.stringify(sourceNode)),
      id: nextNodeId,
      description: sourceNode.description ? `${sourceNode.description} (copy)` : 'Duplicated node',
    };

    const clonedEdges = this.graph.edges
      .filter((edge) => edge.source === nodeId)
      .map((edge) => ({
        ...edge,
        id: this.edgeId(edge.kind, nextNodeId, edge.target, edge.branchLabel),
        source: nextNodeId,
      }));

    const nextGraph: AgentTemplateGraph = {
      ...this.graph,
      nodes: [...this.graph.nodes, cloneNode],
      edges: [...this.graph.edges, ...clonedEdges],
    };

    const sourceLayout = this.layout.nodeLayoutById[nodeId] ?? this.defaultNodeLayout();
    const nextLayout = this.withNodeLayout(nextNodeId, { x: sourceLayout.x + 48, y: sourceLayout.y + 48 }, true);
    this.emitLayout(nextLayout);
    this.emitGraph(nextGraph);
  }

  deleteNode(nodeId: string) {
    if (this.disabled) {
      return;
    }

    const nextNodes = this.graph.nodes.filter((node) => node.id !== nodeId);
    const nextEdges = this.graph.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
    const nextEntryNode = this.graph.entryNodeId === nodeId ? (nextNodes[0]?.id ?? '') : this.graph.entryNodeId;

    const nextLayoutById = { ...this.layout.nodeLayoutById };
    delete nextLayoutById[nodeId];

    if (this.selectedNodeId() === nodeId) {
      this.closeNodeEditor();
    }

    this.emitLayout({
      ...this.layout,
      nodeLayoutById: nextLayoutById,
    });

    this.emitGraph({
      ...this.graph,
      entryNodeId: nextEntryNode,
      nodes: nextNodes,
      edges: nextEdges,
    });
  }

  setEntryNode(nodeId: string) {
    if (this.disabled) {
      return;
    }

    this.emitGraph({
      ...this.graph,
      entryNodeId: nodeId,
    });
  }

  onCreateConnection(event: FCreateConnectionEvent) {
    if (this.disabled || !event.targetId) {
      return;
    }

    this.upsertEdgeByConnectors(event.sourceId, event.targetId);
  }

  onReassignConnection(event: FReassignConnectionEvent) {
    if (this.disabled) {
      return;
    }

    const current = this.graph.edges.find((edge) => edge.id === event.connectionId);
    if (!current) {
      return;
    }

    if (event.endpoint === 'target') {
      if (!event.nextTargetId) {
        this.removeEdgesByIds([event.connectionId]);
        return;
      }

      const nextTarget = this.parseTargetConnector(event.nextTargetId);
      if (!nextTarget) {
        return;
      }

      this.replaceEdgeSemantics(
        current.id,
        {
          sourceNodeId: current.source,
          kind: current.kind,
          branchLabel: current.branchLabel,
        },
        nextTarget,
        true,
        false
      );
      return;
    }

    if (!event.nextSourceId) {
      this.removeEdgesByIds([event.connectionId]);
      return;
    }

    const parsed = this.parseSourceConnector(event.nextSourceId);
    if (!parsed) {
      return;
    }

    this.replaceEdgeSemantics(current.id, parsed, current.target, true, false);
  }

  onDeleteSelected(event: FDeleteSelectedEvent) {
    if (this.disabled) {
      return;
    }

    this.removeNodesByIds(event.nodeIds);
    this.removeEdgesByIds(event.connectionIds);
  }

  onSelectionChange(event: FSelectionChangeEvent) {
    this.selectedNodeIds.set(event.nodeIds);
    this.selectedConnectionIds.set(event.connectionIds);

    const selected = new Set(event.nodeIds);
    const nextLayoutById = Object.fromEntries(
      Object.entries(this.layout.nodeLayoutById).map(([nodeId, nodeLayout]) => [
        nodeId,
        {
          ...nodeLayout,
          selected: selected.has(nodeId),
        },
      ])
    );

    this.emitLayout({
      ...this.layout,
      nodeLayoutById: nextLayoutById,
    });
  }

  onMoveNodes(event: FMoveNodesEvent) {
    if (this.disabled) {
      return;
    }

    const nextLayoutById = { ...this.layout.nodeLayoutById };
    event.nodes.forEach((nodeMove) => {
      const existing = nextLayoutById[nodeMove.id] ?? this.defaultNodeLayout();
      nextLayoutById[nodeMove.id] = {
        ...existing,
        x: nodeMove.position.x,
        y: nodeMove.position.y,
      };
    });

    this.emitLayout({
      ...this.layout,
      nodeLayoutById: nextLayoutById,
    });
  }

  onCanvasChange(event: FCanvasChangeEvent) {
    this.emitLayout({
      ...this.layout,
      viewport: {
        x: event.position.x,
        y: event.position.y,
        zoom: event.scale,
      },
    });
  }

  fitToView() {
    this.canvas?.fitToScreen({ x: 60, y: 60 }, true);
  }

  clearSelection() {
    this.selectedNodeIds.set([]);
    this.selectedConnectionIds.set([]);
    this.selectedNodeId.set(null);
    this.inspectedConnectionId.set(null);

    const nextLayoutById = Object.fromEntries(
      Object.entries(this.layout.nodeLayoutById).map(([nodeId, nodeLayout]) => [
        nodeId,
        {
          ...nodeLayout,
          selected: false,
        },
      ])
    );

    this.emitLayout({
      ...this.layout,
      nodeLayoutById: nextLayoutById,
    });
  }

  deleteSelection() {
    this.removeNodesByIds(this.selectedNodeIds());
    this.removeEdgesByIds(this.selectedConnectionIds());
  }

  addBranchForNode(nodeId: string) {
    const target = this.graph.entryNodeId || this.graph.nodes.find((node) => node.id !== nodeId)?.id || nodeId;
    const label = this.nextBranchLabel(nodeId);
    this.replaceEdgeSemantics(
      this.edgeId('branch', nodeId, target, label),
      { sourceNodeId: nodeId, kind: 'branch', branchLabel: label },
      target,
      true
    );
  }

  sourceConnectorId(edge: AgentGraphEdge) {
    if (edge.kind === 'next') {
      return this.nextConnectorId(edge.source);
    }

    if (edge.kind === 'on_failure') {
      return this.failureConnectorId(edge.source);
    }

    return this.branchConnectorId(edge.source, edge.branchLabel ?? 'default');
  }

  targetConnectorId(nodeId: string) {
    return `${nodeId}::in`;
  }

  outletConnectorId(nodeId: string) {
    return `${nodeId}::outlet`;
  }

  nextConnectorId(nodeId: string) {
    return `${nodeId}::out::next`;
  }

  failureConnectorId(nodeId: string) {
    return `${nodeId}::out::on_failure`;
  }

  branchConnectorId(nodeId: string, label: string) {
    return `${nodeId}::out::branch::${encodeURIComponent(label)}`;
  }

  private upsertEdgeByConnectors(sourceConnectorId: string, targetConnectorId: string) {
    const parsedSource = this.parseSourceConnector(sourceConnectorId);
    const parsedTarget = this.parseTargetConnector(targetConnectorId);

    if (!parsedSource || !parsedTarget) {
      this.connectionError.set('Unable to resolve connector mapping for this connection.');
      return;
    }

    this.connectionError.set(null);
    this.replaceEdgeSemantics(undefined, parsedSource, parsedTarget, true);
  }

  private replaceEdgeSemantics(
    edgeId: string | undefined,
    semantic: SourceConnectorParts,
    targetNodeId: string,
    createWhenMissing = false,
    preserveEdgeId = false
  ) {
    const existingEdge = edgeId ? this.graph.edges.find((edge) => edge.id === edgeId) : undefined;
    if (!existingEdge && !createWhenMissing) {
      return;
    }

    const withoutConflicts = this.graph.edges.filter((edge) => {
      if (edgeId && edge.id === edgeId) {
        return false;
      }

      if (edge.source !== semantic.sourceNodeId) {
        return true;
      }

      if (edge.kind !== semantic.kind) {
        return true;
      }

      if (semantic.kind !== 'branch') {
        return false;
      }

      return edge.branchLabel !== semantic.branchLabel;
    });

    const nextEdge: AgentGraphEdge = {
      id:
        preserveEdgeId && edgeId
          ? edgeId
          : this.edgeId(semantic.kind, semantic.sourceNodeId, targetNodeId, semantic.branchLabel),
      source: semantic.sourceNodeId,
      target: targetNodeId,
      kind: semantic.kind,
      ...(semantic.kind === 'branch' ? { branchLabel: semantic.branchLabel ?? 'default' } : {}),
    };

    if (edgeId && nextEdge.id !== edgeId) {
      this.selectedConnectionIds.update((connectionIds) => connectionIds.map((id) => (id === edgeId ? nextEdge.id : id)));
      if (this.inspectedConnectionId() === edgeId) {
        this.inspectedConnectionId.set(nextEdge.id);
      }
    }

    this.emitGraph({
      ...this.graph,
      edges: [...withoutConflicts, nextEdge],
    });
  }

  private removeNodesByIds(nodeIds: string[]) {
    if (nodeIds.length === 0) {
      return;
    }

    const ids = new Set(nodeIds);
    const nextNodes = this.graph.nodes.filter((node) => !ids.has(node.id));
    const nextEdges = this.graph.edges.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target));
    const nextEntryNode = ids.has(this.graph.entryNodeId) ? (nextNodes[0]?.id ?? '') : this.graph.entryNodeId;

    const nextLayoutById = { ...this.layout.nodeLayoutById };
    for (const nodeId of nodeIds) {
      delete nextLayoutById[nodeId];
    }

    this.emitLayout({
      ...this.layout,
      nodeLayoutById: nextLayoutById,
    });

    this.emitGraph({
      ...this.graph,
      entryNodeId: nextEntryNode,
      nodes: nextNodes,
      edges: nextEdges,
    });
  }

  private removeEdgesByIds(edgeIds: string[]) {
    if (edgeIds.length === 0) {
      return;
    }

    const toDelete = new Set(edgeIds);
    this.selectedConnectionIds.update((connectionIds) => connectionIds.filter((id) => !toDelete.has(id)));
    const inspectedConnectionId = this.inspectedConnectionId();
    if (inspectedConnectionId && toDelete.has(inspectedConnectionId)) {
      this.inspectedConnectionId.set(null);
    }

    this.emitGraph({
      ...this.graph,
      edges: this.graph.edges.filter((edge) => !toDelete.has(edge.id)),
    });
  }

  private parseSourceConnector(connectorId: string): SourceConnectorParts | null {
    const explicitNodeSource = this.resolveNodeAsSource(connectorId);
    if (explicitNodeSource) {
      return explicitNodeSource;
    }

    const tokens = connectorId.split('::');
    if (tokens.length === 2 && tokens[1] === 'outlet') {
      return this.resolveNodeAsSource(tokens[0]);
    }

    if (tokens.length < 3 || tokens[1] !== 'out') {
      return null;
    }

    const sourceNodeId = tokens[0];
    const edgeKind = tokens[2];

    if (edgeKind === 'next') {
      return { sourceNodeId, kind: 'next' };
    }

    if (edgeKind === 'on_failure') {
      return { sourceNodeId, kind: 'on_failure' };
    }

    if (edgeKind === 'branch') {
      const encoded = tokens.slice(3).join('::');
      const label = decodeURIComponent(encoded || 'default');
      return {
        sourceNodeId,
        kind: 'branch',
        branchLabel: label || 'default',
      };
    }

    return null;
  }

  private parseTargetConnector(connectorId: string): string | null {
    if (this.graph.nodes.some((node) => node.id === connectorId)) {
      return connectorId;
    }

    const tokens = connectorId.split('::');
    if (tokens.length !== 2 || tokens[1] !== 'in') {
      return null;
    }

    return tokens[0] || null;
  }

  private resolveNodeAsSource(nodeId: string): SourceConnectorParts | null {
    const node = this.graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) {
      return null;
    }

    if (node.type === 'condition') {
      return {
        sourceNodeId: node.id,
        kind: 'branch',
        branchLabel: this.preferredBranchLabel(node.id),
      };
    }

    if (this.supportsNextEdge(node.type)) {
      return {
        sourceNodeId: node.id,
        kind: 'next',
      };
    }

    return null;
  }

  private preferredBranchLabel(nodeId: string): string {
    const labels = this.graph.edges
      .filter((edge) => edge.source === nodeId && edge.kind === 'branch')
      .map((edge) => edge.branchLabel ?? 'default');

    if (labels.includes('default')) {
      return 'default';
    }

    return labels[0] ?? 'default';
  }

  private findServiceCallNode(nodeId: string) {
    const node = this.graph.nodes.find((candidate) => candidate.id === nodeId);
    return node?.type === 'service_call' ? node : null;
  }

  private parseJsonObject(rawValue: string, message: string): Record<string, unknown> | null {
    const normalized = rawValue.trim();
    if (!normalized) {
      return {};
    }

    try {
      const parsed: unknown = JSON.parse(normalized);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // falls through to error handling below.
    }

    this.nodeConfigError.set(message);
    return null;
  }

  private parseJsonStringMap(rawValue: string, message: string): Record<string, string> | null {
    const parsedObject = this.parseJsonObject(rawValue, message);
    if (!parsedObject) {
      return null;
    }

    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsedObject)) {
      if (value !== null && typeof value === 'object') {
        this.nodeConfigError.set(message);
        return null;
      }

      normalized[String(key)] = value === undefined ? '' : String(value);
    }

    return normalized;
  }

  private parseJsonObjectOrNull(rawValue: string, message: string): Record<string, unknown> | null | undefined {
    const normalized = rawValue.trim();
    if (!normalized) {
      return {};
    }

    if (normalized === 'null') {
      return null;
    }

    const parsed = this.parseJsonObject(normalized, message);
    if (!parsed) {
      return undefined;
    }
    return parsed;
  }

  private edgeLabel(edge: AgentGraphEdge) {
    if (edge.kind === 'branch') {
      return `branch:${edge.branchLabel ?? 'default'}`;
    }

    return edge.kind;
  }

  private edgeDisplayLabel(edge: AgentGraphEdge) {
    if (edge.kind === 'on_failure') {
      return 'If it fails';
    }

    if (edge.kind === 'branch') {
      return edge.branchLabel === 'default' ? 'Otherwise' : `If ${edge.branchLabel ?? 'condition'}`;
    }

    return 'Next';
  }

  private edgeColor(kind: AgentGraphEdge['kind']) {
    if (kind === 'on_failure') {
      return '#b94718';
    }

    if (kind === 'branch') {
      return '#5c48bd';
    }

    return '#16744a';
  }

  private updateGraphNode(nodeId: string, updater: (node: AgentGraphNode) => AgentGraphNode) {
    if (this.disabled) {
      return;
    }

    this.emitGraph({
      ...this.graph,
      nodes: this.graph.nodes.map((node) => (node.id === nodeId ? updater(node) : node)),
    });
  }

  private supportsNextEdge(type: AgentNodeType) {
    return type !== 'condition' && type !== 'terminal_response';
  }

  private supportsFailureEdge(type: AgentNodeType) {
    return type === 'structured_parser' || type === 'service_call' || type === 'llm_step';
  }

  private createGraphNode(type: AgentNodeType, id: string, description: string): AgentGraphNode {
    switch (type) {
      case 'structured_parser':
        return {
          id,
          type,
          description,
          config: {
            source_key: 'last_message',
            strategy: 'regex',
            regex_patterns: {
              value: '(.+)',
            },
            fields: [
              {
                name: 'value',
                type: 'string',
                required: true,
                description: 'Parsed value',
              },
            ],
            strict: false,
          },
        };
      case 'condition':
        return {
          id,
          type,
          description,
          config: {
            expression: 'true',
            input_keys: [],
          },
        };
      case 'service_call':
        return {
          id,
          type,
          description,
          config: {
            mode: 'http',
            url: 'https://api.example.com/service',
            method: 'POST',
            headers_template: {
              'Content-Type': 'application/json',
            },
            body_template: {},
            timeout_seconds: 30,
            allow_unsafe_destination: false,
          },
        };
      case 'user_interrupt':
        return {
          id,
          type,
          description,
          config: {
            prompt: 'Please provide input.',
            output_key: `${id}_output`,
            expected_type: 'text',
          },
        };
      case 'llm_step':
        return {
          id,
          type,
          description,
          config: {
            model_type: 'reasoning',
            model: null,
            system_prompt: 'Respond using available parsed_data and service_results context.',
            max_tokens: 256,
            temperature: 0.2,
            output_key: `${id}_response`,
          },
        };
      case 'terminal_response':
        return {
          id,
          type,
          description,
          config: {
            template: 'Workflow completed.',
            status: 'success',
            include_state_keys: [],
          },
        };
    }
  }

  private createEdge(kind: AgentGraphEdge['kind'], source: string, target: string, branchLabel?: string): AgentGraphEdge {
    return {
      id: this.edgeId(kind, source, target, branchLabel),
      kind,
      source,
      target,
      ...(kind === 'branch' ? { branchLabel: branchLabel ?? 'default' } : {}),
    };
  }

  private uniqueNodeId(type: AgentNodeType) {
    const normalized = NODE_ID_PREFIX_BY_TYPE[type];
    const existing = new Set(this.graph.nodes.map((node) => node.id));
    let index = 1;
    let candidate = `${normalized}_${index}`;
    while (existing.has(candidate)) {
      index += 1;
      candidate = `${normalized}_${index}`;
    }
    return candidate;
  }

  private nextBranchLabel(nodeId: string) {
    const used = new Set(
      this.graph.edges
        .filter((edge) => edge.source === nodeId && edge.kind === 'branch')
        .map((edge) => edge.branchLabel ?? 'default')
    );

    if (!used.has('default')) {
      return 'default';
    }

    let index = 1;
    let candidate = `branch_${index}`;
    while (used.has(candidate)) {
      index += 1;
      candidate = `branch_${index}`;
    }
    return candidate;
  }

  private nextPlacement() {
    const entryNodeLayout = this.layout.nodeLayoutById[this.graph.entryNodeId] ?? this.defaultNodeLayout();
    // Keep growth top-down from the entry column so new steps stack naturally.
    const lowestY = Math.max(entryNodeLayout.y, ...Object.values(this.layout.nodeLayoutById).map((node) => node.y));
    return {
      x: entryNodeLayout.x,
      y: lowestY + 180,
    };
  }

  private withNodeLayout(nodeId: string, position: { x: number; y: number }, selected: boolean) {
    const nextLayoutById: Record<string, GraphNodeLayout> = Object.fromEntries(
      Object.entries(this.layout.nodeLayoutById).map(([existingId, layout]) => [
        existingId,
        {
          ...layout,
          selected: false,
        },
      ])
    );

    nextLayoutById[nodeId] = {
      x: position.x,
      y: position.y,
      selected,
    };

    return {
      ...this.layout,
      nodeLayoutById: nextLayoutById,
    };
  }

  private edgeId(kind: AgentGraphEdge['kind'], source: string, target: string, branchLabel?: string) {
    if (kind === 'branch') {
      return `${source}::branch::${branchLabel ?? 'default'}::${target}`;
    }

    return `${source}::${kind}::${target}`;
  }

  private emitGraph(graph: AgentTemplateGraph) {
    this.zone.run(() => this.graphChange.emit(graph));
  }

  private emitLayout(layout: GraphLayoutState) {
    this.zone.run(() => this.layoutChange.emit(layout));
  }

  private defaultNodeLayout(): GraphNodeLayout {
    return { x: 0, y: 0, selected: false };
  }
}
