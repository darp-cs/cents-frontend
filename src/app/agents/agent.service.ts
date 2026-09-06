import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { API_BASE_URL } from '../core/api-config';

export interface AgentTemplateRecord {
  id: string;
  name: string;
  version: number;
  raw_template: Record<string, unknown> | null;
  is_valid: boolean;
  validation_errors: unknown;
  enabled: boolean;
  created_at: string;
}

export interface SetAgentEnabledPayload {
  enabled: boolean;
  version?: number;
}

@Injectable({ providedIn: 'root' })
export class AgentService {
  private readonly http = inject(HttpClient);

  listAgents() {
    return this.http.get<AgentTemplateRecord[]>(`${API_BASE_URL}/agents`);
  }

  listAgentVersions(name: string) {
    const encodedName = encodeURIComponent(name);
    return this.http.get<AgentTemplateRecord[]>(`${API_BASE_URL}/agents/${encodedName}/versions`);
  }

  setAgentEnabled(name: string, payload: SetAgentEnabledPayload) {
    const encodedName = encodeURIComponent(name);
    return this.http.patch<AgentTemplateRecord>(`${API_BASE_URL}/agents/${encodedName}/enabled`, payload);
  }

  deleteAgent(name: string) {
    const encodedName = encodeURIComponent(name);
    return this.http.delete<void>(`${API_BASE_URL}/agents/${encodedName}`);
  }
}
