import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ToolRecord, ToolService } from '../tool.service';
import { ToolsPageComponent } from './tools-page.component';

const tools: ToolRecord[] = [
  {
    id: 'tool-1',
    name: 'ledger_lookup',
    description: 'Find ledger rows by account id.',
    enabled: true,
    python_code: 'def run(input_data, context):\n    return input_data',
    python_entrypoint: 'run',
    has_python_code: true,
  },
  {
    id: 'tool-2',
    name: 'budget_writer',
    description: 'Create a budget record.',
    enabled: false,
    python_code: null,
    python_entrypoint: 'run',
    has_python_code: false,
  },
];

describe('ToolsPageComponent', () => {
  let fixture: ComponentFixture<ToolsPageComponent>;

  const mockService = {
    listTools: vi.fn(() => of(tools)),
    createTool: vi.fn(
      (payload: {
        name: string;
        description: string;
        enabled: boolean;
        python_code?: string | null;
        python_entrypoint?: string;
      }) =>
        of({
          id: 'tool-3',
          ...payload,
          python_code: payload.python_code ?? null,
          python_entrypoint: payload.python_entrypoint ?? 'run',
          has_python_code: Boolean(payload.python_code),
        } as ToolRecord)
    ),
    updateTool: vi.fn(
      (
        toolId: string,
        payload: {
          name: string;
          description: string;
          enabled?: boolean;
          python_code?: string | null;
          python_entrypoint?: string;
        }
      ) =>
        of({
          id: toolId,
          enabled: payload.enabled ?? true,
          ...payload,
          python_code: payload.python_code ?? null,
          python_entrypoint: payload.python_entrypoint ?? 'run',
          has_python_code: Boolean(payload.python_code),
        } as ToolRecord)
    ),
    setToolEnabled: vi.fn((toolId: string, enabled: boolean) => {
      const current = tools.find((item) => item.id === toolId) ?? tools[0];
      return of({ ...current, enabled });
    }),
    deleteTool: vi.fn(() => of(void 0)),
    testToolCode: vi.fn(() =>
      of({
        compile_ok: true,
        executed: true,
        success: true,
        output: { ok: true },
        error: null,
        traceback: null,
      })
    ),
  };

  beforeEach(async () => {
    mockService.listTools.mockClear();
    mockService.createTool.mockClear();
    mockService.updateTool.mockClear();
    mockService.setToolEnabled.mockClear();
    mockService.deleteTool.mockClear();
    mockService.testToolCode.mockClear();

    await TestBed.configureTestingModule({
      imports: [ToolsPageComponent],
      providers: [{ provide: ToolService, useValue: mockService }],
    }).compileComponents();

    fixture = TestBed.createComponent(ToolsPageComponent);
    fixture.detectChanges();
  });

  it('loads tools on init', () => {
    expect(mockService.listTools).toHaveBeenCalledWith(undefined);

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('ledger_lookup');
  });

  it('changes enabled filter and reloads tools', () => {
    const enabledFilter = fixture.nativeElement.querySelector('[data-testid="filter-enabled"]') as HTMLButtonElement;

    enabledFilter.click();

    expect(mockService.listTools).toHaveBeenCalledWith(true);
  });

  it('creates a tool from form fields', () => {
    const component = fixture.componentInstance;
    component.draftName.set('new_tool');
    component.draftDescription.set('Describe what this tool does.');
    component.draftEnabled.set(true);
    component.draftPythonCode.set('def run(input_data, context):\n    return input_data');
    component.draftPythonEntrypoint.set('run');

    component.saveTool();

    expect(mockService.createTool).toHaveBeenCalledWith({
      name: 'new_tool',
      description: 'Describe what this tool does.',
      enabled: true,
      python_code: 'def run(input_data, context):\n    return input_data',
      python_entrypoint: 'run',
    });
  });

  it('updates a selected tool', () => {
    const component = fixture.componentInstance;
    component.startEdit(tools[0]);
    component.draftName.set('ledger_lookup_v2');
    component.draftDescription.set('Updated description.');
    component.draftEnabled.set(false);
    component.draftPythonCode.set('def execute(input_data, context):\n    return {"ok": True}');
    component.draftPythonEntrypoint.set('execute');

    component.saveTool();

    expect(mockService.updateTool).toHaveBeenCalledWith('tool-1', {
      name: 'ledger_lookup_v2',
      description: 'Updated description.',
      enabled: false,
      python_code: 'def execute(input_data, context):\n    return {"ok": True}',
      python_entrypoint: 'execute',
    });
  });

  it('runs test execution for Python code', () => {
    const component = fixture.componentInstance;
    component.draftPythonCode.set('def run(input_data, context):\n    return {"ok": True}');
    component.draftPythonEntrypoint.set('run');
    component.sampleInputJson.set('{"a": 1}');
    component.sampleContextJson.set('{"source": "spec"}');

    component.testRunCode();

    expect(mockService.testToolCode).toHaveBeenCalledWith({
      python_code: 'def run(input_data, context):\n    return {"ok": True}',
      python_entrypoint: 'run',
      sample_input: { a: 1 },
      sample_context: { source: 'spec' },
      execute: true,
    });
    expect(component.testRunOutput()?.success).toBe(true);
  });

  it('toggles enabled state and deletes with confirmation', () => {
    const component = fixture.componentInstance;
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    component.toggleEnabled(tools[0]);
    component.deleteTool(tools[0]);

    expect(mockService.setToolEnabled).toHaveBeenCalledWith('tool-1', false);
    expect(mockService.deleteTool).toHaveBeenCalledWith('tool-1');

    confirmSpy.mockRestore();
  });
});
