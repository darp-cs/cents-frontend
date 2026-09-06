import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AgentService } from './agent.service';
import { API_BASE_URL } from '../core/api-config';
import { AgentTemplate } from './agent-template.models';

const template: AgentTemplate = {
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
      config: {
        template: 'ok',
        status: 'success',
        include_state_keys: [],
      },
    },
  ],
};

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
      raw_template: template,
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
    service.createAgentVersion('Planner', { ...template, template_version: '1.0.1' }).subscribe();

    const request = httpController.expectOne(`${API_BASE_URL}/agents/Planner`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({
      raw_template: { ...template, template_version: '1.0.1' },
    });

    request.flush({
      id: '2',
      name: 'Planner',
      version: 2,
      raw_template: { ...template, template_version: '1.0.1' },
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
      raw_template: { ...template, template_version: '1.0.1' },
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
      raw_template: template,
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

  it('calls POST /agents/authoring/validate for non-persisting validation', () => {
    service.validateAuthoringTemplate(template).subscribe();

    const request = httpController.expectOne(`${API_BASE_URL}/agents/authoring/validate`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ raw_template: template });

    request.flush({
      is_valid: true,
      normalized_template: template,
      errors: [],
    });
  });

  it('calls GET /agents/authoring/schema for graph palette metadata', () => {
    service.getAuthoringSchema().subscribe();

    const request = httpController.expectOne(`${API_BASE_URL}/agents/authoring/schema`);
    expect(request.request.method).toBe('GET');

    request.flush({
      catalog_version: '1.0.0',
      template_version_pattern: '^\\d+\\.\\d+(\\.\\d+)?$',
      node_id_pattern: '^[A-Za-z][A-Za-z0-9_-]*$',
      guardrails_fields: [],
      node_types: [],
    });
  });
});
