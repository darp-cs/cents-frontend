import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { API_BASE_URL } from '../core/api-config';

export interface ToolRecord {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  python_code: string | null;
  python_entrypoint: string;
  has_python_code: boolean;
}

export interface ToolCreatePayload {
  name: string;
  description: string;
  enabled: boolean;
  python_code?: string | null;
  python_entrypoint?: string;
}

export interface ToolUpdatePayload {
  name: string;
  description: string;
  enabled?: boolean;
  python_code?: string | null;
  python_entrypoint?: string;
}

export interface ToolCodeTestRunPayload {
  python_code: string;
  python_entrypoint: string;
  sample_input: Record<string, unknown>;
  sample_context: Record<string, unknown>;
  execute: boolean;
}

export interface ToolCodeTestRunResponse {
  compile_ok: boolean;
  executed: boolean;
  success: boolean;
  output: unknown | null;
  error: string | null;
  traceback: string | null;
}

@Injectable({ providedIn: 'root' })
export class ToolService {
  private readonly http = inject(HttpClient);

  listTools(enabled?: boolean) {
    let params = new HttpParams();
    if (typeof enabled === 'boolean') {
      params = params.set('enabled', String(enabled));
    }

    return this.http.get<ToolRecord[]>(`${API_BASE_URL}/tools`, { params });
  }

  createTool(payload: ToolCreatePayload) {
    return this.http.post<ToolRecord>(`${API_BASE_URL}/tools`, payload);
  }

  updateTool(toolId: string, payload: ToolUpdatePayload) {
    const encodedToolId = encodeURIComponent(toolId);
    return this.http.put<ToolRecord>(`${API_BASE_URL}/tools/${encodedToolId}`, payload);
  }

  setToolEnabled(toolId: string, enabled: boolean) {
    const encodedToolId = encodeURIComponent(toolId);
    return this.http.patch<ToolRecord>(`${API_BASE_URL}/tools/${encodedToolId}/enabled`, { enabled });
  }

  deleteTool(toolId: string) {
    const encodedToolId = encodeURIComponent(toolId);
    return this.http.delete<void>(`${API_BASE_URL}/tools/${encodedToolId}`);
  }

  testToolCode(payload: ToolCodeTestRunPayload) {
    return this.http.post<ToolCodeTestRunResponse>(`${API_BASE_URL}/tools/test-run`, payload);
  }
}
