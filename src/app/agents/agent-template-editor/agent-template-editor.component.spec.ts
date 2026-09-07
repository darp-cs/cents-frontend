import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { AgentService, AgentTemplateRecord } from '../agent.service';
import { AgentTemplateGraph } from '../agent-template-graph.adapters';
import { AgentTemplate } from '../agent-template.models';
import { ToolService } from '../../tools/tool.service';
import { GraphLayoutState } from './agent-template-draft.store';
import { AgentWorkflowCanvasComponent } from './agent-workflow-canvas.component';
import { AgentTemplateEditorComponent } from './agent-template-editor.component';

@Component({
  selector: 'app-agent-workflow-canvas',
  template: '',
})
class CanvasStubComponent {
  @Input({ required: true }) graph!: AgentTemplateGraph;
  @Input({ required: true }) layout!: GraphLayoutState;
  @Input() paletteLoading = false;
  @Input() paletteError: string | null = null;
  @Input() palette: unknown[] = [];
  @Input() availableTools: Array<{ id: string; name: string }> = [];
  @Input() toolsLoading = false;
  @Input() toolsError: string | null = null;
  @Input() disabled = false;
  @Input() assistingNodeId: string | null = null;
  @Input() nodeAssistError: string | null = null;

  @Output() graphChange = new EventEmitter<AgentTemplateGraph>();
  @Output() layoutChange = new EventEmitter<GraphLayoutState>();
  @Output() nodeAssistRequested = new EventEmitter<{ nodeId: string; instruction: string }>();
}

const loadedTemplate: AgentTemplate = {
  template_version: '1.0.0',
  entry_node: 'final',
  guardrails: {
    max_iterations: 3,
    banned_topics_override: null,
    judge_enabled_override: null,
  },
  nodes: [
    {
      id: 'final',
      type: 'terminal_response',
      config: { template: 'ok', status: 'success', include_state_keys: [] },
    },
  ],
};

const validRecord: AgentTemplateRecord = {
  id: 'validation-1',
  name: '__validate__temp',
  version: 1,
  raw_template: loadedTemplate,
  is_valid: true,
  validation_errors: null,
  enabled: false,
  created_at: '2026-09-05T00:00:00Z',
};

describe('AgentTemplateEditorComponent', () => {
  let fixture: ComponentFixture<AgentTemplateEditorComponent>;

  const mockService = {
    getLatestAgent: vi.fn(() =>
      of({
        id: 'planner-v2',
        name: 'Planner',
        version: 2,
        raw_template: loadedTemplate,
        is_valid: true,
        validation_errors: null,
        enabled: true,
        created_at: '2026-09-05T00:00:00Z',
      } as AgentTemplateRecord)
    ),
    validateAuthoringTemplate: vi.fn((template: AgentTemplate) =>
      of({
        is_valid: true,
        normalized_template: template,
        errors: [],
      })
    ),
    generateAuthoringTemplate: vi.fn((_prompt: string, _template: AgentTemplate) =>
      of({
        message: 'Updated the final response.',
        generated_template: {
          ...loadedTemplate,
          nodes: [
            {
              id: 'final',
              type: 'terminal_response' as const,
              config: { template: 'Generated response', status: 'success' as const, include_state_keys: [] },
            },
          ],
        },
        is_valid: true,
        errors: [],
        referenced_nodes: ['final'],
      })
    ),
    assistAuthoringNode: vi.fn((payload: { current_node: AgentTemplate['nodes'][number] }) =>
      of({
        message: 'Updated node.',
        node: payload.current_node,
        is_valid: true,
        errors: [],
      })
    ),
    createAgentTemplate: vi.fn((_name: string, _template: AgentTemplate) => of(validRecord)),
    createAgentVersion: vi.fn((_name: string, _template: AgentTemplate) => of(validRecord)),
    getAuthoringSchema: vi.fn(() =>
      of({
        catalog_version: '1.0.0',
        template_version_pattern: '^\\d+\\.\\d+(\\.\\d+)?$',
        node_id_pattern: '^[A-Za-z][A-Za-z0-9_-]*$',
        guardrails_fields: [],
        node_types: [
          {
            type: 'structured_parser',
            label: 'Structured Parser',
            description: 'Parser node',
            config_fields: [],
            transitions: [],
          },
          {
            type: 'condition',
            label: 'Condition',
            description: 'Condition node',
            config_fields: [],
            transitions: [],
          },
          {
            type: 'service_call',
            label: 'Service Call',
            description: 'Service node',
            config_fields: [],
            transitions: [],
          },
          {
            type: 'user_interrupt',
            label: 'User Interrupt',
            description: 'Interrupt node',
            config_fields: [],
            transitions: [],
          },
          {
            type: 'llm_step',
            label: 'LLM Step',
            description: 'LLM node',
            config_fields: [],
            transitions: [],
          },
          {
            type: 'terminal_response',
            label: 'Terminal Response',
            description: 'Terminal node',
            config_fields: [],
            transitions: [],
          },
        ],
      })
    ),
  };

  const mockToolService = {
    listTools: vi.fn(() =>
      of([
        {
          id: 'tool-1',
          name: 'credit_profile_lookup',
          description: 'Lookup credit profile',
          enabled: true,
          python_code: null,
          python_entrypoint: 'run',
          has_python_code: false,
        },
        {
          id: 'tool-2',
          name: 'ledger_lookup',
          description: 'Lookup ledger details',
          enabled: true,
          python_code: null,
          python_entrypoint: 'run',
          has_python_code: false,
        },
      ])
    ),
  };

  const router = {
    navigate: vi.fn(() => Promise.resolve(true)),
  };

  function configure(routeName: string | null) {
    mockService.getLatestAgent.mockClear();
    mockService.validateAuthoringTemplate.mockClear();
    mockService.generateAuthoringTemplate.mockClear();
    mockService.assistAuthoringNode.mockClear();
    mockService.createAgentTemplate.mockClear();
    mockService.createAgentVersion.mockClear();
    mockToolService.listTools.mockClear();
    router.navigate.mockClear();

    return TestBed.configureTestingModule({
      imports: [AgentTemplateEditorComponent],
      providers: [
        { provide: AgentService, useValue: mockService },
        { provide: ToolService, useValue: mockToolService },
        { provide: Router, useValue: router },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap(routeName ? { name: routeName } : {}),
            },
          },
        },
      ],
    })
      .overrideComponent(AgentTemplateEditorComponent, {
        remove: {
          imports: [AgentWorkflowCanvasComponent],
        },
        add: {
          imports: [CanvasStubComponent],
        },
      })
      .compileComponents();
  }

  it('starts with a starter template that includes all six node types', async () => {
    await configure(null);
    fixture = TestBed.createComponent(AgentTemplateEditorComponent);
    fixture.detectChanges();

    const template = fixture.componentInstance.template();
    const nodeTypes = template.nodes.map((node) => node.type);
    expect(nodeTypes).toContain('structured_parser');
    expect(nodeTypes).toContain('condition');
    expect(nodeTypes).toContain('service_call');
    expect(nodeTypes).toContain('user_interrupt');
    expect(nodeTypes).toContain('llm_step');
    expect(nodeTypes).toContain('terminal_response');

    const saveButton = fixture.nativeElement.querySelector('[data-testid="save-agent"]') as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
  });

  it('loads enabled tools and passes them to visual graph canvas', async () => {
    await configure(null);
    fixture = TestBed.createComponent(AgentTemplateEditorComponent);
    fixture.detectChanges();

    expect(mockToolService.listTools).toHaveBeenCalledWith(true);

    const canvas = fixture.debugElement.query(By.directive(CanvasStubComponent)).componentInstance as CanvasStubComponent;
    expect(canvas.toolsLoading).toBe(false);
    expect(canvas.toolsError).toBeNull();
    expect(canvas.availableTools.map((tool) => tool.name)).toEqual(['credit_profile_lookup', 'ledger_lookup']);
  });

  it('validates through POST /agents/authoring/validate and enables save for unchanged draft', async () => {
    await configure(null);
    fixture = TestBed.createComponent(AgentTemplateEditorComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.onAgentNameInput('ExpenseApproval');

    component.validateTemplate();
    fixture.detectChanges();

    expect(mockService.validateAuthoringTemplate).toHaveBeenCalledTimes(1);
    expect(component.validationStatus()).toBe('valid');

    const saveButton = fixture.nativeElement.querySelector('[data-testid="save-agent"]') as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);
  });

  it('invalidates validation fingerprint when canonical draft changes after validation', async () => {
    await configure(null);
    fixture = TestBed.createComponent(AgentTemplateEditorComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.onAgentNameInput('ExpenseApproval');
    component.validateTemplate();
    fixture.detectChanges();

    component.onNodeDescriptionInput('parse_1', 'updated description');
    fixture.detectChanges();

    const saveButton = fixture.nativeElement.querySelector('[data-testid="save-agent"]') as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
  });

  it('updates prompts and conditional routes through the conversational editor', async () => {
    await configure(null);
    fixture = TestBed.createComponent(AgentTemplateEditorComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.onNodePromptInput('interrupt_1', 'Can I continue with this request?');
    component.onNodePromptInput('decision_1', 'parsed_data.amount >= 500');
    component.onConditionBranchTargetInput('decision_1', 'true', 'think_1');

    const interruptNode = component.template().nodes.find((node) => node.id === 'interrupt_1');
    const conditionNode = component.template().nodes.find((node) => node.id === 'decision_1');

    if (!interruptNode || interruptNode.type !== 'user_interrupt') {
      throw new Error('Expected starter user interrupt node');
    }
    if (!conditionNode || conditionNode.type !== 'condition') {
      throw new Error('Expected starter condition node');
    }

    expect(interruptNode.config.prompt).toBe('Can I continue with this request?');
    expect(conditionNode.config.expression).toBe('parsed_data.amount >= 500');
    expect(conditionNode.branches['true']).toBe('think_1');
    expect(component.draftJsonPreview()).toContain('Can I continue with this request?');
  });

  it('loads one of three built-in example sub-agents into source and graph draft', async () => {
    await configure(null);
    fixture = TestBed.createComponent(AgentTemplateEditorComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const options = fixture.nativeElement.querySelectorAll('#example-template option') as NodeListOf<HTMLOptionElement>;
    expect(options).toHaveLength(3);

    component.onExampleSelectionInput('meeting-planner');
    component.applySelectedExample();
    fixture.detectChanges();

    expect(component.template().entry_node).toBe('parse_1');
    expect(component.authoringPrompt()).toContain('Meeting Planner');
    expect(component.generationMessage()).toContain('Loaded example: Meeting Planner');
  });

  it('keeps readable workflow source visible and applies its equivalent graph', async () => {
    await configure(null);
    fixture = TestBed.createComponent(AgentTemplateEditorComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const sourceEditor = fixture.nativeElement.querySelector('.workflow-source') as HTMLTextAreaElement;
    expect(sourceEditor.value).toBe('');
    expect(fixture.nativeElement.querySelector('.authoring-thread')).toBeNull();

    const source = [
      'Credit Recommendations',
      '',
      '@if the user is authenticated',
      '  do this',
      '@else',
      '  do this',
      '',
      '@interrupt the user to clarify if more information is needed',
    ].join('\n');
    component.onAuthoringPromptInput(source);

    component.generateFromDescription();
    fixture.detectChanges();

    expect(mockService.generateAuthoringTemplate).toHaveBeenCalledTimes(1);
    expect(mockService.generateAuthoringTemplate).toHaveBeenCalledWith(source, null);
    expect(component.authoringPrompt()).toBe(source);
    expect(component.template().nodes[0].id).toBe('final');
    expect(component.graph().nodes[0].id).toBe('final');
    expect(component.draftJsonPreview()).toContain('Generated response');
    expect(component.generationMessage()).toBe('Updated the final response.');
    expect(component.validationStatus()).toBe('valid');
  });

  it('shares one canonical draft across mode switching', async () => {
    await configure(null);
    fixture = TestBed.createComponent(AgentTemplateEditorComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.setEditorMode('visual-graph');
    const graphCopy = JSON.parse(JSON.stringify(component.graph())) as AgentTemplateGraph;
    graphCopy.nodes[0].description = 'graph edit text';
    component.onGraphChanged(graphCopy);
    component.setEditorMode('advanced-json');

    expect(component.draftJsonPreview()).toContain('graph edit text');
    expect(component.authoringPrompt()).toContain('graph edit text');
  });

  it('mirrors tool-mode action config into the natural-language source', async () => {
    await configure(null);
    fixture = TestBed.createComponent(AgentTemplateEditorComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const graphCopy = JSON.parse(JSON.stringify(component.graph())) as AgentTemplateGraph;
    const serviceNode = graphCopy.nodes.find((node) => node.id === 'action_1');
    if (!serviceNode || serviceNode.type !== 'service_call') {
      throw new Error('Expected starter action_1 service_call node');
    }

    serviceNode.config.mode = 'tool';
    serviceNode.config.url = null;
    serviceNode.config.tool_name = 'credit_profile_lookup';
    serviceNode.config.tool_input_template = {
      account_id: '{{ parsed_data.account_id }}',
      amount: '{{ parsed_data.amount }}',
    };

    component.onGraphChanged(graphCopy);

    expect(component.graphEquivalentSource()).toContain('use tool credit_profile_lookup');
    expect(component.authoringPrompt()).toContain('use tool credit_profile_lookup');
  });

  it('loads existing template and saves using versioned PUT flow', async () => {
    await configure('Planner');
    fixture = TestBed.createComponent(AgentTemplateEditorComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(mockService.getLatestAgent).toHaveBeenCalledWith('Planner');
    expect(component.isEditing()).toBe(true);
    expect(fixture.nativeElement.querySelector('.json-workspace')).toBeNull();

    component.setEditorMode('advanced-json');
    fixture.detectChanges();

    const jsonPanes = fixture.nativeElement.querySelectorAll('.json-pane') as NodeListOf<HTMLElement>;
    expect(jsonPanes).toHaveLength(2);
    expect(jsonPanes[1].textContent).toContain('Latest saved version');

    component.validateTemplate();
    component.saveTemplate();

    expect(mockService.createAgentVersion).toHaveBeenCalledTimes(1);
    const savedTemplate = mockService.createAgentVersion.mock.calls[0]?.[1] as AgentTemplate;
    expect(savedTemplate.canvas_layout).toBeDefined();
    expect(router.navigate).toHaveBeenCalledWith(['/agents']);
  });

  it('includes graph layout data in the saved raw template', async () => {
    await configure(null);
    fixture = TestBed.createComponent(AgentTemplateEditorComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.onAgentNameInput('ExpenseApproval');
    component.onGraphLayoutChanged({
      ...component.graphLayout(),
      nodeLayoutById: {
        ...component.graphLayout().nodeLayoutById,
        parse_1: {
          x: 220,
          y: 120,
          selected: true,
        },
      },
    });
    component.validateTemplate();
    component.saveTemplate();

    const savedTemplate = mockService.createAgentTemplate.mock.calls[0]?.[1] as unknown;
    expect(savedTemplate).toBeDefined();
    const canvasLayout = (savedTemplate as AgentTemplate).canvas_layout;
    expect(canvasLayout).toBeDefined();
    expect(canvasLayout?.node_positions['parse_1']).toEqual({ x: 220, y: 120 });
    expect((canvasLayout?.node_positions as Record<string, unknown>)['selected']).toBeUndefined();
    expect(canvasLayout?.viewport).toEqual(component.graphLayout().viewport);
  });

  it('updates canonical draft from graphChange events', async () => {
    await configure(null);
    fixture = TestBed.createComponent(AgentTemplateEditorComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const nextGraph = JSON.parse(JSON.stringify(component.graph())) as AgentTemplateGraph;
    nextGraph.edges = nextGraph.edges.filter((edge) => edge.kind !== 'on_failure');
    component.onGraphChanged(nextGraph);

    const parseNode = component.template().nodes.find((node) => node.id === 'parse_1');
    if (!parseNode || parseNode.type !== 'structured_parser') {
      throw new Error('Expected parse_1 structured_parser node in starter template');
    }
    expect(parseNode.on_failure).toBeUndefined();
  });

  it('requests node assist and applies validated node update', async () => {
    await configure(null);
    fixture = TestBed.createComponent(AgentTemplateEditorComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.onNodeAssistRequested({
      nodeId: 'parse_1',
      instruction: 'Extract currency and normalize amount.',
    });

    expect(mockService.assistAuthoringNode).toHaveBeenCalledTimes(1);
    expect(component.assistingNodeId()).toBeNull();
    expect(component.nodeAssistError()).toBeNull();
  });
});
