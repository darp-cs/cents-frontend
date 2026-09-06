import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { API_BASE_URL } from '../core/api-config';
import { AgentTemplate } from './agent-template.models';

export interface AgentTemplateRecord {
  id: string;
  name: string;
  version: number;
  raw_template: unknown | null;
  is_valid: boolean;
  validation_errors: unknown;
  enabled: boolean;
  created_at: string;
}

export interface AgentAuthoringValidationError {
  path: string;
  node_id: string | null;
  message: string;
}

export interface AgentAuthoringValidateResponse {
  is_valid: boolean;
  normalized_template: unknown | null;
  errors: AgentAuthoringValidationError[];
}

export interface SetAgentEnabledPayload {
  enabled: boolean;
  version?: number;
}

export interface AgentTemplateUpsertPayload {
  name: string;
  raw_template: AgentTemplate;
}

@Injectable({ providedIn: 'root' })
export class AgentService {
  private readonly http = inject(HttpClient);

  createAgentTemplate(name: string, rawTemplate: AgentTemplate) {
    const payload: AgentTemplateUpsertPayload = {
      name,
      raw_template: rawTemplate,
    };
    return this.http.post<AgentTemplateRecord>(`${API_BASE_URL}/agents`, payload);
  }

  createAgentVersion(name: string, rawTemplate: AgentTemplate) {
    const encodedName = encodeURIComponent(name);
    return this.http.put<AgentTemplateRecord>(`${API_BASE_URL}/agents/${encodedName}`, {
      raw_template: rawTemplate,
    });
  }

  validateAuthoringTemplate(rawTemplate: AgentTemplate) {
    return this.http.post<AgentAuthoringValidateResponse>(`${API_BASE_URL}/agents/authoring/validate`, {
      raw_template: rawTemplate,
    });
  }

  getAuthoringSchema() {
    return this.http.get<unknown>(`${API_BASE_URL}/agents/authoring/schema`);
  }

  getLatestAgent(name: string) {
    const encodedName = encodeURIComponent(name);
    return this.http.get<AgentTemplateRecord>(`${API_BASE_URL}/agents/${encodedName}`);
  }

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
