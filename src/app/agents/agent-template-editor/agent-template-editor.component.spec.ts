import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { AgentService, AgentTemplateRecord } from '../agent.service';
import { AgentTemplate } from '../agent-template.models';
import { AgentTemplateEditorComponent } from './agent-template-editor.component';

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
    createAgentTemplate: vi.fn((_name: string, _template: AgentTemplate) => of(validRecord)),
    createAgentVersion: vi.fn((_name: string, _template: AgentTemplate) => of(validRecord)),
    getAuthoringSchema: vi.fn(() => of({})),
  };

  const router = {
    navigate: vi.fn(() => Promise.resolve(true)),
  };

  function configure(routeName: string | null) {
    mockService.getLatestAgent.mockClear();
    mockService.validateAuthoringTemplate.mockClear();
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
    }).compileComponents();
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

  it('shares one canonical draft across mode switching', async () => {
    await configure(null);
    fixture = TestBed.createComponent(AgentTemplateEditorComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.setEditorMode('visual-graph');
    component.onNodeDescriptionInput('parse_input', 'graph edit text');
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
    component.onNodeCoordinateInput('parse_input', 'x', '220');
    component.validateTemplate();
    component.saveTemplate();

    const savedTemplate = mockService.createAgentTemplate.mock.calls[0]?.[1] as unknown;
    expect(savedTemplate).toBeDefined();
    expect((savedTemplate as Record<string, unknown>)['nodeLayoutById']).toBeUndefined();
    expect((savedTemplate as Record<string, unknown>)['viewport']).toBeUndefined();
  });
});
