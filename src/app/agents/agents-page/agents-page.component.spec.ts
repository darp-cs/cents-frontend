import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Router } from '@angular/router';
import { AgentService, AgentTemplateRecord } from '../agent.service';
import { AgentsPageComponent } from './agents-page.component';

const latestAgents: AgentTemplateRecord[] = [
  {
    id: 'v3',
    name: 'Planner',
    version: 3,
    raw_template: {},
    is_valid: true,
    validation_errors: null,
    enabled: true,
    created_at: '2026-09-05T00:00:00Z',
  },
  {
    id: 'v1',
    name: 'BrokenAgent',
    version: 1,
    raw_template: {},
    is_valid: false,
    validation_errors: ['entry_node does not exist'],
    enabled: false,
    created_at: '2026-09-04T00:00:00Z',
  },
];

describe('AgentsPageComponent', () => {
  let fixture: ComponentFixture<AgentsPageComponent>;

  const mockService = {
    listAgents: vi.fn(() => of(latestAgents)),
    listAgentVersions: vi.fn(() =>
      of([
        {
          id: 'v3',
          name: 'Planner',
          version: 3,
          raw_template: {},
          is_valid: true,
          validation_errors: null,
          enabled: true,
          created_at: '2026-09-05T00:00:00Z',
        },
        {
          id: 'v2',
          name: 'Planner',
          version: 2,
          raw_template: {},
          is_valid: true,
          validation_errors: null,
          enabled: false,
          created_at: '2026-09-03T00:00:00Z',
        },
      ] as AgentTemplateRecord[])
    ),
    setAgentEnabled: vi.fn(() =>
      of({
        id: 'v3',
        name: 'Planner',
        version: 3,
        raw_template: {},
        is_valid: true,
        validation_errors: null,
        enabled: false,
        created_at: '2026-09-05T00:00:00Z',
      } as AgentTemplateRecord)
    ),
    deleteAgent: vi.fn(() => of(void 0)),
  };

  const router = {
    navigate: vi.fn(() => Promise.resolve(true)),
  };

  beforeEach(async () => {
    mockService.listAgents.mockClear();
    mockService.listAgentVersions.mockClear();
    mockService.setAgentEnabled.mockClear();
    mockService.deleteAgent.mockClear();
    router.navigate.mockClear();

    await TestBed.configureTestingModule({
      imports: [AgentsPageComponent],
      providers: [
        { provide: AgentService, useValue: mockService },
        { provide: Router, useValue: router },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AgentsPageComponent);
    fixture.detectChanges();
  });

  it('loads agents on init and renders latest version', () => {
    expect(mockService.listAgents).toHaveBeenCalledTimes(1);

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Planner');
    expect(text).toContain('v3');
  });

  it('disables enable action when an agent is invalid', () => {
    const rows = Array.from(fixture.nativeElement.querySelectorAll('tbody tr')) as HTMLTableRowElement[];
    const brokenRow = rows.find((row) => row.textContent?.includes('BrokenAgent'));
    const enableButton = brokenRow?.querySelector('.toggle-enabled') as HTMLButtonElement;

    expect(enableButton.disabled).toBe(true);
  });

  it('loads version history when view history is clicked', () => {
    const rows = Array.from(fixture.nativeElement.querySelectorAll('tbody tr')) as HTMLTableRowElement[];
    const plannerRow = rows.find((row) => row.textContent?.includes('Planner'));
    const historyButton = plannerRow?.querySelector('.toggle-history') as HTMLButtonElement;

    historyButton.click();
    fixture.detectChanges();

    expect(mockService.listAgentVersions).toHaveBeenCalledWith('Planner');
    expect(fixture.nativeElement.textContent as string).toContain('Version history');
  });

  it('navigates to template editor when New agent is clicked', () => {
    const newAgentButton = fixture.nativeElement.querySelector('[data-testid="new-agent"]') as HTMLButtonElement;

    newAgentButton.click();

    expect(router.navigate).toHaveBeenCalledWith(['/agents/new']);
  });

  it('asks for confirmation before delete and deletes when confirmed', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    const rows = Array.from(fixture.nativeElement.querySelectorAll('tbody tr')) as HTMLTableRowElement[];
    const plannerRow = rows.find((row) => row.textContent?.includes('Planner'));
    const deleteButton = plannerRow?.querySelector('.delete-agent') as HTMLButtonElement;

    deleteButton.click();

    expect(confirmSpy).toHaveBeenCalled();
    expect(mockService.deleteAgent).toHaveBeenCalledWith('Planner');

    confirmSpy.mockRestore();
  });
});
