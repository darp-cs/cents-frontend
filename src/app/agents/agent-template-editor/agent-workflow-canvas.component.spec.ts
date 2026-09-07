import '../../../test-setup';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  FConnectorDirective,
  FCreateConnectionEvent,
  FDeleteSelectedEvent,
  FNodeDirective,
  FReassignConnectionEvent,
  FSelectionChangeEvent,
} from '@foblex/flow';
import { AgentTemplateGraph } from '../agent-template-graph.adapters';
import { AgentTemplate } from '../agent-template.models';
import { templateToGraph } from '../agent-template-graph.adapters';
import { GraphLayoutState } from './agent-template-draft.store';
import { AgentCanvasPaletteItem, AgentWorkflowCanvasComponent } from './agent-workflow-canvas.component';

const palette: AgentCanvasPaletteItem[] = [
  { type: 'structured_parser', label: 'Parse', icon: 'SP', description: 'Parser' },
  { type: 'condition', label: 'Decision', icon: '?', description: 'Condition' },
  { type: 'service_call', label: 'Action', icon: 'API', description: 'Service' },
  { type: 'user_interrupt', label: 'Interrupt', icon: 'USR', description: 'Interrupt' },
  { type: 'llm_step', label: 'Think', icon: 'LLM', description: 'LLM' },
  { type: 'terminal_response', label: 'Reply', icon: 'END', description: 'Terminal' },
];

const baseTemplate: AgentTemplate = {
  template_version: '1.0.0',
  entry_node: 'parse',
  guardrails: {
    max_iterations: 3,
    banned_topics_override: null,
    judge_enabled_override: null,
  },
  nodes: [
    {
      id: 'parse',
      type: 'structured_parser',
      description: 'Parse user input',
      config: {
        source_key: 'last_message',
        strategy: 'regex',
        regex_patterns: { value: '(.+)' },
        fields: [{ name: 'value', type: 'string', required: true }],
      },
      next: 'final_success',
      on_failure: 'final_failure',
    },
    {
      id: 'final_success',
      type: 'terminal_response',
      config: { template: 'ok', status: 'success', include_state_keys: [] },
    },
    {
      id: 'final_failure',
      type: 'terminal_response',
      config: { template: 'no', status: 'failure', include_state_keys: [] },
    },
  ],
};

describe('AgentWorkflowCanvasComponent', () => {
  let fixture: ComponentFixture<AgentWorkflowCanvasComponent>;
  let component: AgentWorkflowCanvasComponent;

  function layoutFromGraph(graph: AgentTemplateGraph): GraphLayoutState {
    const nodeLayoutById = graph.nodes.reduce<Record<string, { x: number; y: number; selected: boolean }>>(
      (accumulator, node, index) => {
        accumulator[node.id] = { x: 100 + index * 240, y: 100, selected: false };
        return accumulator;
      },
      {}
    );

    return {
      nodeLayoutById,
      viewport: { x: 0, y: 0, zoom: 1 },
    };
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgentWorkflowCanvasComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(AgentWorkflowCanvasComponent);
    component = fixture.componentInstance;

    const graph = templateToGraph(baseTemplate);
    component.graph = graph;
    component.layout = layoutFromGraph(graph);
    component.palette = palette;
    fixture.detectChanges();
  });

  it('inserts a node from the schema-driven palette', () => {
    let emitted: AgentTemplateGraph | undefined;
    component.graphChange.subscribe((graph) => {
      emitted = graph;
    });

    component.addNodeFromPalette(palette[2]);

    expect(emitted).toBeDefined();
    if (!emitted) {
      throw new Error('Expected graph mutation to emit');
    }
    expect(emitted.nodes.some((node) => node.type === 'service_call')).toBe(true);
    expect(component.selectedNodeId()).toBe('action_1');
    expect(component.componentPickerOpen()).toBe(false);
  });

  it('opens one node editor at a time and updates prompt fields', () => {
    const promptTemplate: AgentTemplate = {
      template_version: '1.0.0',
      entry_node: 'ask',
      guardrails: baseTemplate.guardrails,
      nodes: [
        {
          id: 'ask',
          type: 'user_interrupt',
          config: {
            prompt: 'Continue?',
            output_key: 'confirmation',
            expected_type: 'confirmation',
          },
          next: 'finish',
        },
        {
          id: 'finish',
          type: 'terminal_response',
          config: { template: 'Done', status: 'success', include_state_keys: [] },
        },
      ],
    };
    const graph = templateToGraph(promptTemplate);
    component.graph = graph;
    component.layout = layoutFromGraph(graph);
    component.graphChange.subscribe((nextGraph) => {
      component.graph = nextGraph;
    });

    component.openNodeEditor('ask');
    expect(component.selectedNode()?.id).toBe('ask');

    component.updateNodeEditableText('ask', 'Would you like to continue?');
    const askNode = component.graph.nodes.find((node) => node.id === 'ask');
    expect(askNode?.type).toBe('user_interrupt');
    if (!askNode || askNode.type !== 'user_interrupt') {
      throw new Error('Expected user interrupt node');
    }
    expect(askNode.config.prompt).toBe('Would you like to continue?');

    component.openNodeEditor('finish');
    expect(component.selectedNode()?.id).toBe('finish');
    expect(component.selectedNodeIds()).toEqual(['finish']);
  });

  it('opens the node editor on double-click but not on click or selection', () => {
    const firstNode = fixture.nativeElement.querySelector('.flow-node') as HTMLElement;

    firstNode.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(component.selectedNodeId()).toBeNull();

    component.onSelectionChange(new FSelectionChangeEvent(['parse'], [], []));
    expect(component.selectedNodeIds()).toEqual(['parse']);
    expect(component.selectedNodeId()).toBeNull();

    firstNode.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(component.selectedNodeId()).toBe('parse');
  });

  it('creates an edge from connector handles', () => {
    let emitted: AgentTemplateGraph | undefined;
    component.graphChange.subscribe((graph) => {
      emitted = graph;
    });

    const createEvent = new FCreateConnectionEvent(
      component.failureConnectorId('parse'),
      component.targetConnectorId('final_success'),
      { x: 0, y: 0 }
    );

    component.onCreateConnection(createEvent);

    expect(emitted).toBeDefined();
    if (!emitted) {
      throw new Error('Expected graph mutation to emit');
    }
    expect(emitted.edges.some((edge) => edge.source === 'parse' && edge.kind === 'on_failure')).toBe(true);
  });

  it('renders connector circles plus quick-connect outlets for drag-to-connect', () => {
    const allConnectors = fixture.debugElement.queryAll(By.directive(FConnectorDirective));
    const connectorTypes = allConnectors.map((connector) => connector.injector.get(FConnectorDirective).fConnectorType());
    const nodeElements = fixture.debugElement.queryAll(By.directive(FNodeDirective));

    expect(connectorTypes).toContain('source');
    expect(connectorTypes).toContain('target');
    expect(connectorTypes).toContain('outlet');
    expect(nodeElements.every((nodeElement) => nodeElement.injector.get(FNodeDirective).fConnectOnNode())).toBe(true);
  });

  it('accepts node-id targets for quick drag-to-connect gestures', () => {
    let emitted: AgentTemplateGraph | undefined;
    component.graphChange.subscribe((graph) => {
      emitted = graph;
    });

    const createEvent = new FCreateConnectionEvent(component.nextConnectorId('parse'), 'final_failure', { x: 4, y: 8 });
    component.onCreateConnection(createEvent);

    expect(emitted).toBeDefined();
    if (!emitted) {
      throw new Error('Expected graph mutation to emit');
    }

    const updatedEdge = emitted.edges.find((edge) => edge.source === 'parse' && edge.kind === 'next');
    expect(updatedEdge?.target).toBe('final_failure');
  });

  it('accepts node-id sources for quick drag-to-connect gestures', () => {
    let emitted: AgentTemplateGraph | undefined;
    component.graphChange.subscribe((graph) => {
      emitted = graph;
    });

    const createEvent = new FCreateConnectionEvent('parse', component.targetConnectorId('final_failure'), { x: 4, y: 8 });
    component.onCreateConnection(createEvent);

    expect(emitted).toBeDefined();
    if (!emitted) {
      throw new Error('Expected graph mutation to emit');
    }

    const updatedEdge = emitted.edges.find((edge) => edge.source === 'parse' && edge.kind === 'next');
    expect(updatedEdge?.target).toBe('final_failure');
  });

  it('opens route details on edge double-click, not on edge selection', () => {
    component.onSelectionChange(new FSelectionChangeEvent([], [], ['parse::next::final_success']));
    expect(component.inspectedConnection()).toBeNull();

    fixture.detectChanges();
    const routeToggle = fixture.nativeElement.querySelector('.edge-chip-trigger') as HTMLElement;
    routeToggle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    fixture.detectChanges();

    expect(component.inspectedConnection()?.id).toBe('parse::next::final_success');
    expect(fixture.nativeElement.querySelector('.edge-inspector')).not.toBeNull();
  });

  it('renders connections with native f-connection paths only', () => {
    const renderedOverlayPaths = fixture.nativeElement.querySelectorAll('.visible-edge-line') as NodeListOf<SVGPathElement>;
    expect(renderedOverlayPaths.length).toBe(0);

    const nativeConnections = fixture.nativeElement.querySelectorAll('f-connection, .f-connection');
    expect(nativeConnections.length).toBeGreaterThan(0);
  });

  it('emits node assist request from natural-language instruction', () => {
    let emitted: { nodeId: string; instruction: string } | undefined;
    component.nodeAssistRequested.subscribe((request) => {
      emitted = request;
    });

    component.openNodeEditor('parse');
    fixture.detectChanges();

    component.updateNodeAssistDraft('parse', 'Route high-value requests to approval.');
    component.requestNodeAssist('parse');

    expect(emitted).toEqual({
      nodeId: 'parse',
      instruction: 'Route high-value requests to approval.',
    });
  });

  it('reconnects and deletes edges', () => {
    let emitted: AgentTemplateGraph | undefined;
    component.graphChange.subscribe((graph) => {
      emitted = graph;
      component.graph = graph;
    });

    const nextEdgeId = 'parse::next::final_success';
    const reassignEvent = new FReassignConnectionEvent(
      nextEdgeId,
      'target',
      component.nextConnectorId('parse'),
      component.nextConnectorId('parse'),
      component.targetConnectorId('final_success'),
      component.targetConnectorId('final_failure'),
      { x: 12, y: 12 }
    );

    component.onReassignConnection(reassignEvent);
    if (!emitted) {
      throw new Error('Expected graph mutation to emit');
    }
    const reassigned = emitted.edges.find((edge) => edge.source === 'parse' && edge.kind === 'next');
    expect(reassigned?.target).toBe('final_failure');
    expect(reassigned?.id).toBe('parse::next::final_failure');

    if (!reassigned) {
      throw new Error('Expected next edge after reassignment');
    }

    component.onDeleteSelected(new FDeleteSelectedEvent([], [], [reassigned.id]));
    expect(component.graph.edges.some((edge) => edge.id === reassigned.id)).toBe(false);
  });

  it('configures a service_call node for registered tool usage', () => {
    component.graphChange.subscribe((graph) => {
      component.graph = graph;
    });

    component.addNodeFromPalette(palette[2]);
    const serviceNode = component.graph.nodes.find((node) => node.id === 'action_1');
    if (!serviceNode || serviceNode.type !== 'service_call') {
      throw new Error('Expected service_call node action_1');
    }

    component.updateServiceMode(serviceNode.id, 'tool');
    component.updateServiceToolName(serviceNode.id, 'ledger_lookup');
    component.updateServiceToolId(serviceNode.id, 'tool-id-123');
    component.updateServiceToolInputTemplate(
      serviceNode.id,
      '{"account_id": "{{ parsed_data.account_id }}", "amount": "{{ parsed_data.amount }}"}'
    );
    component.updateServiceTimeout(serviceNode.id, '45');

    const updated = component.graph.nodes.find((node) => node.id === 'action_1');
    if (!updated || updated.type !== 'service_call') {
      throw new Error('Expected updated service_call node action_1');
    }

    expect(updated.config.mode).toBe('tool');
    expect(updated.config.url).toBeNull();
    expect(updated.config.tool_name).toBe('ledger_lookup');
    expect(updated.config.tool_id).toBe('tool-id-123');
    expect(updated.config.tool_input_template).toEqual({
      account_id: '{{ parsed_data.account_id }}',
      amount: '{{ parsed_data.amount }}',
    });
    expect(updated.config.timeout_seconds).toBe(45);
  });

  it('shows a config error when service_call tool input template is invalid JSON', () => {
    component.graphChange.subscribe((graph) => {
      component.graph = graph;
    });

    component.addNodeFromPalette(palette[2]);
    component.updateServiceMode('action_1', 'tool');
    component.updateServiceToolInputTemplate('action_1', '[1, 2, 3]');

    expect(component.nodeConfigError()).toContain('Tool input template must be a JSON object.');
  });

  it('keeps minimal canvas mode active with no assist-tools panels', () => {
    expect(fixture.nativeElement.textContent).not.toContain('assist tools');
    expect(fixture.nativeElement.querySelector('.canvas-secondary-tools')).toBeNull();
  });

  it('renames branch labels from the node route editor and remaps edge id', () => {
    let emitted: AgentTemplateGraph | undefined;
    component.graphChange.subscribe((graph) => {
      emitted = graph;
      component.graph = graph;
    });

    component.addNodeFromPalette(palette[1]);
    if (!emitted) {
      throw new Error('Expected graph emission after adding condition node');
    }
    component.layout = layoutFromGraph(emitted);

    const conditionNode = component.graph.nodes.find((node) => node.type === 'condition');
    if (!conditionNode) {
      throw new Error('Expected condition node to exist');
    }

    component.addBranchForNode(conditionNode.id);
    const branchEdge = component.graph.edges.find(
      (edge) => edge.source === conditionNode.id && edge.kind === 'branch' && edge.branchLabel === 'default'
    );
    if (!branchEdge) {
      throw new Error('Expected condition branch edge to exist');
    }

    component.updateBranchLabel(branchEdge.id, 'approved');

    const renamed = component.graph.edges.find(
      (edge) =>
        edge.source === conditionNode.id &&
        edge.kind === 'branch' &&
        edge.branchLabel === 'approved' &&
        edge.target === branchEdge.target
    );
    expect(renamed).toBeDefined();
    expect(renamed?.id).toContain('::branch::approved::');
    expect(component.graph.edges.some((edge) => edge.id === branchEdge.id)).toBe(false);
  });

  it('rejects duplicate branch labels in the node route editor', () => {
    const existingTemplate: AgentTemplate = {
      template_version: '1.0.0',
      entry_node: 'check',
      guardrails: {
        max_iterations: 4,
        banned_topics_override: null,
        judge_enabled_override: true,
      },
      nodes: [
        {
          id: 'check',
          type: 'condition',
          config: {
            expression: 'parsed_data.value == "ok"',
            input_keys: ['parsed_data.value'],
          },
          branches: {
            approved: 'finish',
            default: 'fallback',
          },
        },
        {
          id: 'finish',
          type: 'terminal_response',
          config: { template: 'done', status: 'success', include_state_keys: [] },
        },
        {
          id: 'fallback',
          type: 'terminal_response',
          config: { template: 'no', status: 'failure', include_state_keys: [] },
        },
      ],
    };

    const graph = templateToGraph(existingTemplate);
    component.graph = graph;
    component.layout = layoutFromGraph(graph);
    fixture.detectChanges();

    const defaultEdge = component.graph.edges.find(
      (edge) => edge.source === 'check' && edge.kind === 'branch' && edge.branchLabel === 'default'
    );
    if (!defaultEdge) {
      throw new Error('Expected default branch edge');
    }

    component.updateBranchLabel(defaultEdge.id, 'approved');

    expect(component.connectionError()).toContain("already exists");
    expect(component.graph.edges.some((edge) => edge.id === defaultEdge.id)).toBe(true);
  });

  it('marks exactly one entry node when changed', () => {
    let emitted: AgentTemplateGraph | undefined;
    component.graphChange.subscribe((graph) => {
      emitted = graph;
    });

    component.setEntryNode('final_failure');

    expect(emitted?.entryNodeId).toBe('final_failure');
  });

  it('updates canonical graph payload on edge mutation and preserves semantic labels', () => {
    let emitted: AgentTemplateGraph | undefined;
    component.graphChange.subscribe((graph) => {
      emitted = graph;
    });

    component.addNodeFromPalette(palette[1]);
    if (!emitted) {
      throw new Error('Expected graph mutation to emit');
    }
    const latest = emitted;
    const conditionNode = latest.nodes.find((node) => node.type === 'condition');
    if (!conditionNode) {
      throw new Error('Expected condition node to exist after palette insertion');
    }

    component.graph = latest;
    component.layout = layoutFromGraph(latest);

    component.addBranchForNode(conditionNode.id);

    if (!emitted) {
      throw new Error('Expected branch mutation to emit');
    }
    const branchEdge = emitted.edges.find((edge) => edge.source === conditionNode.id && edge.kind === 'branch');
    expect(branchEdge).toBeDefined();
    expect(branchEdge?.branchLabel).toBeDefined();
  });

  it('reconstructs node and edge view models from an existing template graph', () => {
    const existingTemplate: AgentTemplate = {
      template_version: '1.0.0',
      entry_node: 'check',
      guardrails: {
        max_iterations: 4,
        banned_topics_override: null,
        judge_enabled_override: true,
      },
      nodes: [
        {
          id: 'check',
          type: 'condition',
          config: {
            expression: 'parsed_data.value == "ok"',
            input_keys: ['parsed_data.value'],
          },
          branches: {
            approved: 'finish',
            default: 'fallback',
          },
        },
        {
          id: 'finish',
          type: 'terminal_response',
          config: { template: 'done', status: 'success', include_state_keys: [] },
        },
        {
          id: 'fallback',
          type: 'terminal_response',
          config: { template: 'no', status: 'failure', include_state_keys: [] },
        },
      ],
    };

    const graph = templateToGraph(existingTemplate);
    component.graph = graph;
    component.layout = layoutFromGraph(graph);
    fixture.detectChanges();

    const nodeViews = component.nodeViews();
    const connectionViews = component.connectionViews();

    expect(nodeViews.length).toBe(3);
    expect(nodeViews.find((node) => node.id === 'finish')?.supportsNext).toBe(false);
    expect(connectionViews.some((connection) => connection.label === 'branch:approved')).toBe(true);
    expect(connectionViews.some((connection) => connection.label === 'branch:default')).toBe(true);
    expect(connectionViews.some((connection) => connection.displayLabel === 'If approved')).toBe(true);
    expect(connectionViews.some((connection) => connection.displayLabel === 'Otherwise')).toBe(true);
  });
});
