import { Component, EventEmitter, Input, NgZone, OnChanges, Output, ViewChild, inject, signal } from '@angular/core';
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

interface EdgeRouteViewModel {
  id: string;
  path: string;
  color: string;
  markerId: string;
}

const FALLBACK_LABELS: Record<AgentNodeType, string> = {
  structured_parser: 'Structured Parser',
  condition: 'Condition',
  service_call: 'Service Call',
  user_interrupt: 'User Interrupt',
  llm_step: 'LLM Step',
  terminal_response: 'Terminal Response',
};

const FALLBACK_ICONS: Record<AgentNodeType, string> = {
  structured_parser: 'SP',
  condition: '?',
  service_call: 'API',
  user_interrupt: 'USR',
  llm_step: 'LLM',
  terminal_response: 'END',
};

@Component({
  selector: 'app-agent-workflow-canvas',
  standalone: true,
  imports: [FFlowModule],
  templateUrl: './agent-workflow-canvas.component.html',
  styleUrl: './agent-workflow-canvas.component.css',
  providers: [provideFFlow(withA11y(), withConnectionFlow('click'))],
})
export class AgentWorkflowCanvasComponent implements OnChanges {
  private readonly zone = inject(NgZone);

  @Input({ required: true }) graph!: AgentTemplateGraph;
  @Input({ required: true }) layout!: GraphLayoutState;
  @Input() palette: AgentCanvasPaletteItem[] = [];
  @Input() paletteLoading = false;
  @Input() paletteError: string | null = null;
  @Input() disabled = false;

  @Output() graphChange = new EventEmitter<AgentTemplateGraph>();
  @Output() layoutChange = new EventEmitter<GraphLayoutState>();

  @ViewChild('canvas') private canvas?: FCanvasComponent;

  readonly selectedNodeIds = signal<string[]>([]);
  readonly selectedConnectionIds = signal<string[]>([]);
  readonly selectedNodeId = signal<string | null>(null);
  readonly componentPickerOpen = signal(false);
  readonly assistToolsOpen = signal(false);

  readonly connectionSource = signal('');
  readonly connectionTarget = signal('');
  readonly connectionError = signal<string | null>(null);

  ngOnChanges(): void {
    this.syncConnectionComposerDefaults();
  }

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

  edgeRoutes(): EdgeRouteViewModel[] {
    return this.graph.edges.flatMap((edge, edgeIndex) => {
      const source = this.layout.nodeLayoutById[edge.source];
      const target = this.layout.nodeLayoutById[edge.target];
      if (!source || !target) {
        return [];
      }

      const sourceX = source.x + 220;
      const sourceY = source.y + this.edgeSourceOffset(edge, edgeIndex);
      const targetX = target.x;
      const targetY = target.y + 76;
      const path = this.orthogonalEdgePath(sourceX, sourceY, targetX, targetY, edgeIndex);
      return [
        {
          id: edge.id,
          path,
          color: this.edgeColor(edge.kind),
          markerId: `edge-arrow-${edge.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
        },
      ];
    });
  }

  edgeOverlayWidth() {
    const furthestNode = Math.max(0, ...Object.values(this.layout.nodeLayoutById).map((position) => position.x));
    return Math.max(2400, furthestNode + 600);
  }

  edgeOverlayHeight() {
    const lowestNode = Math.max(0, ...Object.values(this.layout.nodeLayoutById).map((position) => position.y));
    return Math.max(1600, lowestNode + 500);
  }

  edgeOverlayTransform() {
    return `translate(${this.layout.viewport.x}px, ${this.layout.viewport.y}px) scale(${this.layout.viewport.zoom})`;
  }

  selectedNode() {
    const nodeId = this.selectedNodeId();
    return nodeId ? (this.graph.nodes.find((node) => node.id === nodeId) ?? null) : null;
  }

  outgoingConnections(nodeId: string) {
    return this.connectionViews().filter((connection) => connection.sourceNodeId === nodeId);
  }

  toggleComponentPicker() {
    this.componentPickerOpen.update((open) => !open);
  }

  openNodeEditor(nodeId: string) {
    this.selectedNodeId.set(nodeId);
    this.selectedNodeIds.set([nodeId]);
    this.componentPickerOpen.set(false);
  }

  closeNodeEditor() {
    this.selectedNodeId.set(null);
    this.selectedNodeIds.set([]);
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
    this.updateGraphNode(nodeId, (node) =>
      node.type === 'service_call' ? { ...node, config: { ...node.config, url } } : node
    );
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

  toggleAssistTools() {
    this.assistToolsOpen.update((open) => !open);
  }

  deleteEdgeById(connectionId: string) {
    this.removeEdgesByIds([connectionId]);
  }

  sourceConnectorOptions() {
    const options: Array<{ id: string; label: string }> = [];

    for (const node of this.graph.nodes) {
      const label = FALLBACK_LABELS[node.type];
      if (this.supportsNextEdge(node.type)) {
        options.push({
          id: this.nextConnectorId(node.id),
          label: `${node.id} (${label}) -> next`,
        });
      }

      if (this.supportsFailureEdge(node.type)) {
        options.push({
          id: this.failureConnectorId(node.id),
          label: `${node.id} (${label}) -> on_failure`,
        });
      }

      if (node.type === 'condition') {
        for (const branch of this.conditionBranchOutputs(node.id)) {
          options.push({
            id: branch.connectorId,
            label: `${node.id} (${label}) -> branch:${branch.label}`,
          });
        }
      }
    }

    return options;
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
    this.selectedNodeId.set(event.nodeIds[0] ?? this.selectedNodeId());

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

  createConnectionWithoutPointer() {
    if (!this.connectionSource() || !this.connectionTarget()) {
      this.connectionError.set('Choose source and target before creating a connection.');
      return;
    }

    this.connectionError.set(null);
    this.upsertEdgeByConnectors(this.connectionSource(), this.targetConnectorId(this.connectionTarget()));
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

  nextConnectorId(nodeId: string) {
    return `${nodeId}::out::next`;
  }

  failureConnectorId(nodeId: string) {
    return `${nodeId}::out::on_failure`;
  }

  branchConnectorId(nodeId: string, label: string) {
    return `${nodeId}::out::branch::${encodeURIComponent(label)}`;
  }

  private syncConnectionComposerDefaults() {
    const sources = this.sourceConnectorOptions();
    const targets = this.targetNodeOptions();

    if (!sources.some((source) => source.id === this.connectionSource())) {
      this.connectionSource.set(sources[0]?.id ?? '');
    }

    if (!targets.some((target) => target.id === this.connectionTarget())) {
      this.connectionTarget.set(targets[0]?.id ?? '');
    }
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

    this.emitGraph({
      ...this.graph,
      edges: this.graph.edges.filter((edge) => !toDelete.has(edge.id)),
    });
  }

  private parseSourceConnector(connectorId: string): SourceConnectorParts | null {
    const tokens = connectorId.split('::');
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
    const tokens = connectorId.split('::');
    if (tokens.length !== 2 || tokens[1] !== 'in') {
      return null;
    }

    return tokens[0] || null;
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

  private edgeSourceOffset(edge: AgentGraphEdge, edgeIndex: number) {
    if (edge.kind === 'next') {
      return 104;
    }

    if (edge.kind === 'on_failure') {
      return 132;
    }

    const siblingIndex = this.graph.edges
      .filter((candidate) => candidate.source === edge.source && candidate.kind === 'branch')
      .findIndex((candidate) => candidate.id === edge.id);
    return 112 + Math.max(0, siblingIndex) * 28 + (edgeIndex % 2) * 2;
  }

  private orthogonalEdgePath(sourceX: number, sourceY: number, targetX: number, targetY: number, edgeIndex: number) {
    if (targetX >= sourceX + 64) {
      const middleX = sourceX + (targetX - sourceX) / 2;
      return `M ${sourceX} ${sourceY} L ${middleX} ${sourceY} L ${middleX} ${targetY} L ${targetX} ${targetY}`;
    }

    const sideX = Math.max(sourceX, targetX + 220) + 72 + (edgeIndex % 4) * 18;
    const upperY = Math.max(24, Math.min(sourceY, targetY) - 68 - (edgeIndex % 3) * 18);
    return `M ${sourceX} ${sourceY} L ${sideX} ${sourceY} L ${sideX} ${upperY} L ${targetX - 36} ${upperY} L ${targetX - 36} ${targetY} L ${targetX} ${targetY}`;
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
    const normalized = type.replace(/[^a-zA-Z0-9_]/g, '_');
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
    const index = this.graph.nodes.length;
    return {
      x: 90 + (index % 3) * 290,
      y: 80 + Math.floor(index / 3) * 220,
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
