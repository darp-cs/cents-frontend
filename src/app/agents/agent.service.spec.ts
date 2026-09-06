import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AgentService } from './agent.service';
import { API_BASE_URL } from '../core/api-config';

describe('AgentService', () => {
  let service: AgentService;
  let httpController: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(AgentService);
    httpController = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpController.verify();
  });

  it('calls GET /agents', () => {
    service.listAgents().subscribe();

    const request = httpController.expectOne(`${API_BASE_URL}/agents`);
    expect(request.request.method).toBe('GET');

    request.flush([]);
  });

  it('calls POST /agents to create a new template', () => {
    const payload = {
      name: 'Planner',
      raw_template: { template_version: '1.0.0' },
    };

    service.createAgentTemplate(payload.name, payload.raw_template).subscribe();

    const request = httpController.expectOne(`${API_BASE_URL}/agents`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(payload);

    request.flush({
      id: '1',
      name: payload.name,
      version: 1,
      raw_template: payload.raw_template,
      is_valid: true,
      validation_errors: null,
      enabled: true,
      created_at: '2026-09-05T00:00:00Z',
    });
  });

  it('calls PUT /agents/{name} to create a new version', () => {
    service.createAgentVersion('Planner', { template_version: '1.0.1' }).subscribe();

    const request = httpController.expectOne(`${API_BASE_URL}/agents/Planner`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({
      raw_template: { template_version: '1.0.1' },
    });

    request.flush({
      id: '2',
      name: 'Planner',
      version: 2,
      raw_template: { template_version: '1.0.1' },
      is_valid: true,
      validation_errors: null,
      enabled: true,
      created_at: '2026-09-05T00:00:00Z',
    });
  });

  it('calls GET /agents/{name} for latest agent detail', () => {
    service.getLatestAgent('Planner').subscribe();

    const request = httpController.expectOne(`${API_BASE_URL}/agents/Planner`);
    expect(request.request.method).toBe('GET');

    request.flush({
      id: '2',
      name: 'Planner',
      version: 2,
      raw_template: { template_version: '1.0.1' },
      is_valid: true,
      validation_errors: null,
      enabled: true,
      created_at: '2026-09-05T00:00:00Z',
    });
  });

  it('calls GET /agents/{name}/versions', () => {
    const name = 'Agent Alpha/1';

    service.listAgentVersions(name).subscribe();

    const request = httpController.expectOne(`${API_BASE_URL}/agents/Agent%20Alpha%2F1/versions`);
    expect(request.request.method).toBe('GET');

    request.flush([]);
  });

  it('calls PATCH /agents/{name}/enabled', () => {
    const name = 'Planner';
    const payload = { enabled: true, version: 3 };

    service.setAgentEnabled(name, payload).subscribe();

    const request = httpController.expectOne(`${API_BASE_URL}/agents/Planner/enabled`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual(payload);

    request.flush({
      id: '1',
      name,
      version: 3,
      raw_template: {},
      is_valid: true,
      validation_errors: null,
      enabled: true,
      created_at: '2026-09-05T00:00:00Z',
    });
  });

  it('calls DELETE /agents/{name}', () => {
    service.deleteAgent('Planner').subscribe();

    const request = httpController.expectOne(`${API_BASE_URL}/agents/Planner`);
    expect(request.request.method).toBe('DELETE');

    request.flush(null);
  });
});
