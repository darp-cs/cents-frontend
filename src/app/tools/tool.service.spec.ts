import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { API_BASE_URL } from '../core/api-config';
import { ToolService } from './tool.service';

describe('ToolService', () => {
  let service: ToolService;
  let httpController: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(ToolService);
    httpController = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpController.verify();
  });

  it('calls GET /tools without enabled filter', () => {
    service.listTools().subscribe();

    const request = httpController.expectOne(`${API_BASE_URL}/tools`);
    expect(request.request.method).toBe('GET');
    expect(request.request.params.has('enabled')).toBe(false);

    request.flush([]);
  });

  it('calls GET /tools with enabled filter', () => {
    service.listTools(true).subscribe();

    const request = httpController.expectOne(`${API_BASE_URL}/tools?enabled=true`);
    expect(request.request.method).toBe('GET');

    request.flush([]);
  });

  it('calls POST /tools', () => {
    const payload = {
      name: 'ledger_lookup',
      description: 'Find ledger records',
      enabled: true,
      python_code: 'def run(input_data, context):\n    return input_data',
      python_entrypoint: 'run',
    };

    service.createTool(payload).subscribe();

    const request = httpController.expectOne(`${API_BASE_URL}/tools`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(payload);

    request.flush({ id: '1', ...payload });
  });

  it('calls PUT /tools/{id}', () => {
    const payload = {
      name: 'ledger_lookup_v2',
      description: 'Updated description',
      enabled: false,
      python_code: 'def execute(input_data, context):\n    return {"ok": True}',
      python_entrypoint: 'execute',
    };

    service.updateTool('tool id/1', payload).subscribe();

    const request = httpController.expectOne(`${API_BASE_URL}/tools/tool%20id%2F1`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual(payload);

    request.flush({ id: 'tool id/1', ...payload });
  });

  it('calls PATCH /tools/{id}/enabled', () => {
    service.setToolEnabled('1', false).subscribe();

    const request = httpController.expectOne(`${API_BASE_URL}/tools/1/enabled`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ enabled: false });

    request.flush({ id: '1', name: 'ledger_lookup', description: 'desc', enabled: false });
  });

  it('calls DELETE /tools/{id}', () => {
    service.deleteTool('1').subscribe();

    const request = httpController.expectOne(`${API_BASE_URL}/tools/1`);
    expect(request.request.method).toBe('DELETE');

    request.flush(null);
  });

  it('calls POST /tools/test-run', () => {
    const payload = {
      python_code: 'def run(input_data, context):\n    return {"ok": True}',
      python_entrypoint: 'run',
      sample_input: { value: 1 },
      sample_context: { source: 'spec' },
      execute: true,
    };

    service.testToolCode(payload).subscribe();

    const request = httpController.expectOne(`${API_BASE_URL}/tools/test-run`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(payload);

    request.flush({
      compile_ok: true,
      executed: true,
      success: true,
      output: { ok: true },
      error: null,
      traceback: null,
    });
  });
});
