import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { AgentService, AgentTemplateRecord } from '../agent.service';
import { AgentTemplateEditorComponent } from './agent-template-editor.component';

const validRecord: AgentTemplateRecord = {
  id: 'validation-1',
  name: '__validate__temp',
  version: 1,
  raw_template: {},
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
        raw_template: {
          template_version: '1.0.0',
          entry_node: 'final',
          nodes: [
            {
              id: 'final',
              type: 'terminal_response',
              config: { template: 'ok', status: 'success', include_state_keys: [] },
            },
          ],
        },
        is_valid: true,
        validation_errors: null,
        enabled: true,
        created_at: '2026-09-05T00:00:00Z',
      } as AgentTemplateRecord)
    ),
    createAgentTemplate: vi.fn(() => of(validRecord)),
    createAgentVersion: vi.fn(() => of(validRecord)),
    deleteAgent: vi.fn(() => of(void 0)),
  };

  const router = {
    navigate: vi.fn(() => Promise.resolve(true)),
  };

  function configure(routeName: string | null) {
    mockService.getLatestAgent.mockClear();
    mockService.createAgentTemplate.mockClear();
    mockService.createAgentVersion.mockClear();
    mockService.deleteAgent.mockClear();
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

    const draft = fixture.componentInstance.draftJson();
    expect(draft).toContain('structured_parser');
    expect(draft).toContain('condition');
    expect(draft).toContain('service_call');
    expect(draft).toContain('user_interrupt');
    expect(draft).toContain('llm_step');
    expect(draft).toContain('terminal_response');

    const saveButton = fixture.nativeElement.querySelector('[data-testid="save-agent"]') as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
  });

  it('validates through POST /agents and enables save for an unchanged valid draft', async () => {
    await configure(null);
    fixture = TestBed.createComponent(AgentTemplateEditorComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.onAgentNameInput('ExpenseApproval');

    component.validateTemplate();
    fixture.detectChanges();

    expect(mockService.createAgentTemplate).toHaveBeenCalledTimes(1);
    expect(mockService.deleteAgent).toHaveBeenCalledTimes(1);
    expect(component.validationStatus()).toBe('valid');

    const saveButton = fixture.nativeElement.querySelector('[data-testid="save-agent"]') as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);
  });

  it('disables save again when draft changes after validation', async () => {
    await configure(null);
    fixture = TestBed.createComponent(AgentTemplateEditorComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    component.onAgentNameInput('ExpenseApproval');
    component.validateTemplate();
    fixture.detectChanges();

    component.onDraftInput(`${component.draftJson()}\n`);
    fixture.detectChanges();

    const saveButton = fixture.nativeElement.querySelector('[data-testid="save-agent"]') as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
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

    expect(mockService.createAgentVersion).toHaveBeenCalledWith(
      'Planner',
      JSON.parse(component.draftJson()) as Record<string, unknown>
    );
    expect(router.navigate).toHaveBeenCalledWith(['/agents']);
  });
});
