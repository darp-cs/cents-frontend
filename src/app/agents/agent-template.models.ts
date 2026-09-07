export type AgentNodeType =
  | 'structured_parser'
  | 'condition'
  | 'service_call'
  | 'user_interrupt'
  | 'llm_step'
  | 'terminal_response';

export interface ParsedField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'array';
  required: boolean;
  enum_values?: string[] | null;
  description?: string | null;
}

export interface StructuredParserConfig {
  source_key: string;
  strategy: 'regex' | 'llm';
  regex_patterns: Record<string, string>;
  llm_prompt_instructions?: string | null;
  llm_model_type?: string | null;
  llm_model?: string | null;
  llm_temperature?: number | null;
  llm_max_tokens?: number | null;
  fields: ParsedField[];
  strict?: boolean;
}

export interface ConditionConfig {
  expression: string;
  input_keys: string[];
}

export interface ServiceCallConfig {
  mode: 'http' | 'tool';
  url?: string | null;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers_template: Record<string, string>;
  body_template?: Record<string, unknown> | null;
  tool_name?: string | null;
  tool_id?: string | null;
  tool_input_template?: Record<string, unknown>;
  timeout_seconds?: number | null;
  allow_unsafe_destination?: boolean;
}

export interface UserInterruptConfig {
  prompt: string;
  output_key: string;
  expected_type: 'text' | 'choice' | 'confirmation';
  choices?: string[] | null;
}

export interface LLMStepConfig {
  model_type: string;
  model?: string | null;
  system_prompt: string;
  max_tokens: number;
  temperature: number;
  output_key?: string | null;
}

export interface TerminalResponseConfig {
  template: string;
  status: 'success' | 'failure' | 'cancelled';
  include_state_keys: string[];
}

export interface Guardrails {
  max_iterations: number;
  banned_topics_override: string[] | null;
  judge_enabled_override: boolean | null;
}

export interface AgentCanvasLayoutNodePosition {
  x: number;
  y: number;
}

export interface AgentCanvasLayoutViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface AgentCanvasLayout {
  node_positions: Record<string, AgentCanvasLayoutNodePosition>;
  viewport?: AgentCanvasLayoutViewport | null;
}

interface BaseNode {
  id: string;
  description?: string | null;
}

export interface StructuredParserNode extends BaseNode {
  type: 'structured_parser';
  config: StructuredParserConfig;
  next: string;
  on_failure?: string | null;
}

export interface ConditionNode extends BaseNode {
  type: 'condition';
  config: ConditionConfig;
  branches: Record<string, string>;
}

export interface ServiceCallNode extends BaseNode {
  type: 'service_call';
  config: ServiceCallConfig;
  next: string;
  on_failure?: string | null;
}

export interface UserInterruptNode extends BaseNode {
  type: 'user_interrupt';
  config: UserInterruptConfig;
  next: string;
}

export interface LLMStepNode extends BaseNode {
  type: 'llm_step';
  config: LLMStepConfig;
  next: string;
  on_failure?: string | null;
}

export interface TerminalResponseNode extends BaseNode {
  type: 'terminal_response';
  config: TerminalResponseConfig;
}

export type AgentTemplateNode =
  | StructuredParserNode
  | ConditionNode
  | ServiceCallNode
  | UserInterruptNode
  | LLMStepNode
  | TerminalResponseNode;

export interface AgentTemplate {
  template_version: string;
  entry_node: string;
  nodes: AgentTemplateNode[];
  guardrails: Guardrails;
  canvas_layout?: AgentCanvasLayout | null;
}

export function cloneTemplate(template: AgentTemplate): AgentTemplate {
  return JSON.parse(JSON.stringify(template)) as AgentTemplate;
}

export function isAgentTemplate(value: unknown): value is AgentTemplate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['template_version'] === 'string' &&
    typeof candidate['entry_node'] === 'string' &&
    Array.isArray(candidate['nodes']) &&
    typeof candidate['guardrails'] === 'object' &&
    candidate['guardrails'] !== null &&
    !Array.isArray(candidate['guardrails']) &&
    (!('canvas_layout' in candidate) ||
      candidate['canvas_layout'] === null ||
      (typeof candidate['canvas_layout'] === 'object' && !Array.isArray(candidate['canvas_layout'])))
  );
}
