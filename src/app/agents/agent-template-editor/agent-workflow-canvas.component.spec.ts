import '../../../test-setup';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FCreateConnectionEvent, FDeleteSelectedEvent, FReassignConnectionEvent } from '@foblex/flow';
import { AgentTemplateGraph } from '../agent-template-graph.adapters';
import { AgentTemplate } from '../agent-template.models';
import { templateToGraph } from '../agent-template-graph.adapters';
import { GraphLayoutState } from './agent-template-draft.store';
import { AgentCanvasPaletteItem, AgentWorkflowCanvasComponent } from './agent-workflow-canvas.component';

const palette: AgentCanvasPaletteItem[] = [
  { type: 'structured_parser', label: 'Structured Parser', icon: 'SP', description: 'Parser' },
  { type: 'condition', label: 'Condition', icon: '?', description: 'Condition' },
  { type: 'service_call', label: 'Service Call', icon: 'API', description: 'Service' },
  { type: 'user_interrupt', label: 'User Interrupt', icon: 'USR', description: 'Interrupt' },
  { type: 'llm_step', label: 'LLM Step', icon: 'LLM', description: 'LLM' },
  { type: 'terminal_response', label: 'Terminal Response', icon: 'END', description: 'Terminal' },
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

  it('toggles assist tools visibility state', () => {
    expect(component.assistToolsOpen()).toBe(false);

    component.toggleAssistTools();
    expect(component.assistToolsOpen()).toBe(true);

    component.toggleAssistTools();
    expect(component.assistToolsOpen()).toBe(false);
  });

  it('renames branch edge labels inline and remaps edge id', () => {
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

    component.startBranchEdit(branchEdge.id);
    component.branchLabelDraft.set('approved');
    component.applyBranchEdit(branchEdge.id);

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
    expect(component.isBranchEditing(branchEdge.id)).toBe(false);
  });

  it('rejects duplicate branch labels during inline rename', () => {
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

    component.startBranchEdit(defaultEdge.id);
    component.branchLabelDraft.set('approved');
    component.applyBranchEdit(defaultEdge.id);

    expect(component.connectionError()).toContain("already exists");
    expect(component.isBranchEditing(defaultEdge.id)).toBe(true);
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
  });
});
