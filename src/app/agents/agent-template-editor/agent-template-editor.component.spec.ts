import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { AgentService, AgentTemplateRecord } from '../agent.service';
import { AgentTemplateGraph } from '../agent-template-graph.adapters';
import { AgentTemplate } from '../agent-template.models';
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
  @Input() disabled = false;

  @Output() graphChange = new EventEmitter<AgentTemplateGraph>();
  @Output() layoutChange = new EventEmitter<GraphLayoutState>();
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

  const router = {
    navigate: vi.fn(() => Promise.resolve(true)),
  };

  function configure(routeName: string | null) {
    mockService.getLatestAgent.mockClear();
    mockService.validateAuthoringTemplate.mockClear();
    mockService.generateAuthoringTemplate.mockClear();
    mockService.createAgentTemplate.mockClear();
    mockService.createAgentVersion.mockClear();
    router.navigate.mockClear();

    return TestBed.configureTestingModule({
      imports: [AgentTemplateEditorComponent],
      providers: [
        { provide: AgentService, useValue: mockService },
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

    component.onNodeDescriptionInput('parse_input', 'updated description');
    fixture.detectChanges();

    const saveButton = fixture.nativeElement.querySelector('[data-testid="save-agent"]') as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
  });

  it('updates prompts and conditional routes through the conversational editor', async () => {
    await configure(null);
    fixture = TestBed.createComponent(AgentTemplateEditorComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.onNodePromptInput('ask_user_confirmation', 'Can I continue with this request?');
    component.onNodePromptInput('route_request', 'parsed_data.amount >= 500');
    component.onConditionBranchTargetInput('route_request', 'true', 'draft_response');

    const interruptNode = component.template().nodes.find((node) => node.id === 'ask_user_confirmation');
    const conditionNode = component.template().nodes.find((node) => node.id === 'route_request');

    if (!interruptNode || interruptNode.type !== 'user_interrupt') {
      throw new Error('Expected starter user interrupt node');
    }
    if (!conditionNode || conditionNode.type !== 'condition') {
      throw new Error('Expected starter condition node');
    }

    expect(interruptNode.config.prompt).toBe('Can I continue with this request?');
    expect(conditionNode.config.expression).toBe('parsed_data.amount >= 500');
    expect(conditionNode.branches['true']).toBe('draft_response');
    expect(component.draftJsonPreview()).toContain('Can I continue with this request?');
  });

  it('generates and applies a validated draft from a prompt with reference tokens', async () => {
    await configure(null);
    fixture = TestBed.createComponent(AgentTemplateEditorComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.onAuthoringPromptInput('Update');
    component.insertAuthoringToken('@final');
    component.insertAuthoringToken('/reply');
    expect(component.authoringPrompt()).toBe('Update @final /reply ');

    component.generateFromDescription();
    fixture.detectChanges();

    expect(mockService.generateAuthoringTemplate).toHaveBeenCalledTimes(1);
    expect(mockService.generateAuthoringTemplate.mock.calls[0]?.[0]).toBe('Update @final /reply');
    expect(component.template().nodes[0].id).toBe('final');
    expect(component.draftJsonPreview()).toContain('Generated response');
    expect(component.authoringMessages().at(-1)?.status).toBe('applied');
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
  });

  it('loads existing template and saves using versioned PUT flow', async () => {
    await configure('Planner');
    fixture = TestBed.createComponent(AgentTemplateEditorComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(mockService.getLatestAgent).toHaveBeenCalledWith('Planner');
    expect(component.isEditing()).toBe(true);
    expect(fixture.nativeElement.textContent as string).toContain('Latest Saved Version');

    component.validateTemplate();
    component.saveTemplate();

    expect(mockService.createAgentVersion).toHaveBeenCalledWith('Planner', component.template());
    expect(router.navigate).toHaveBeenCalledWith(['/agents']);
  });

  it('never includes graph layout data in the saved raw template', async () => {
    await configure(null);
    fixture = TestBed.createComponent(AgentTemplateEditorComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.onAgentNameInput('ExpenseApproval');
    component.onGraphLayoutChanged({
      ...component.graphLayout(),
      nodeLayoutById: {
        ...component.graphLayout().nodeLayoutById,
        parse_input: {
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
    expect((savedTemplate as Record<string, unknown>)['nodeLayoutById']).toBeUndefined();
    expect((savedTemplate as Record<string, unknown>)['viewport']).toBeUndefined();
  });

  it('updates canonical draft from graphChange events', async () => {
    await configure(null);
    fixture = TestBed.createComponent(AgentTemplateEditorComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const nextGraph = JSON.parse(JSON.stringify(component.graph())) as AgentTemplateGraph;
    nextGraph.edges = nextGraph.edges.filter((edge) => edge.kind !== 'on_failure');
    component.onGraphChanged(nextGraph);

    const parseNode = component.template().nodes.find((node) => node.id === 'parse_input');
    if (!parseNode || parseNode.type !== 'structured_parser') {
      throw new Error('Expected parse_input structured_parser node in starter template');
    }
    expect(parseNode.on_failure).toBeUndefined();
  });
});
