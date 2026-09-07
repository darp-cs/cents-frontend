import { describe, expect, it } from 'vitest';
import { AgentTemplate } from './agent-template.models';
import { graphToTemplate, templateToGraph } from './agent-template-graph.adapters';

const representativeTemplate: AgentTemplate = {
  template_version: '1.2.0',
  entry_node: 'parse_input',
  guardrails: {
    max_iterations: 4,
    banned_topics_override: ['politics', 'medical'],
    judge_enabled_override: true,
  },
  nodes: [
    {
      id: 'parse_input',
      type: 'structured_parser',
      description: 'Parse expense details from user text.',
      config: {
        source_key: 'last_message',
        strategy: 'regex',
        regex_patterns: {
          amount: '\\b(\\d+(?:\\.\\d{1,2})?)\\b',
          category: '\\b(travel|food|supplies)\\b',
        },
        fields: [
          {
            name: 'amount',
            type: 'number',
            required: true,
            description: 'Expense amount',
          },
          {
            name: 'category',
            type: 'enum',
            required: true,
            enum_values: ['travel', 'food', 'supplies'],
            description: 'Expense category',
          },
        ],
        strict: true,
      },
      next: 'route_request',
      on_failure: 'terminal_failure',
    },
    {
      id: 'route_request',
      type: 'condition',
      description: 'Route by amount threshold.',
      config: {
        expression: 'parsed_data.amount > 1000',
        input_keys: ['parsed_data.amount'],
      },
      branches: {
        high_value: 'request_approval',
        default: 'draft_response',
      },
    },
    {
      id: 'request_approval',
      type: 'service_call',
      description: 'Call approval API for high-value spend.',
      config: {
        mode: 'http',
        url: 'https://api.example.com/approval',
        method: 'POST',
        headers_template: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer {{ secrets.approval_token }}',
        },
        body_template: {
          amount: '{{parsed_data.amount}}',
          category: '{{parsed_data.category}}',
        },
        timeout_seconds: 15,
        allow_unsafe_destination: false,
      },
      next: 'draft_response',
      on_failure: 'manual_confirmation',
    },
    {
      id: 'manual_confirmation',
      type: 'user_interrupt',
      description: 'Ask user for manual approval when service fails.',
      config: {
        prompt: 'Service was unavailable. Continue anyway?',
        output_key: 'manual_approval',
        expected_type: 'confirmation',
      },
      next: 'draft_response',
    },
    {
      id: 'draft_response',
      type: 'llm_step',
      description: 'Build the final assistant response.',
      config: {
        model_type: 'reasoning',
        model: 'example-reasoner',
        system_prompt:
          'Summarize parsed_data.category {{ parsed_data.category }} and amount {{ parsed_data.amount }}.',
        max_tokens: 256,
        temperature: 0.1,
        output_key: 'assistant_summary',
      },
      next: 'terminal_success',
      on_failure: 'terminal_failure',
    },
    {
      id: 'terminal_success',
      type: 'terminal_response',
      description: 'Finish with success.',
      config: {
        template: 'Expense request recorded.',
        status: 'success',
        include_state_keys: ['parsed_data', 'service_results'],
      },
    },
    {
      id: 'terminal_failure',
      type: 'terminal_response',
      description: 'Finish with failure.',
      config: {
        template: 'Unable to process request.',
        status: 'failure',
        include_state_keys: ['parsed_data'],
      },
    },
  ],
};

describe('agent template graph adapters', () => {
  it('round-trips representative templates without semantic loss', () => {
    const graph = templateToGraph(representativeTemplate);
    const reconstructed = graphToTemplate(graph);

    expect(reconstructed).toEqual(representativeTemplate);
  });

  it('preserves stable node ids and branch labels in graph projection', () => {
    const graph = templateToGraph(representativeTemplate);

    expect(graph.nodes.map((node) => node.id)).toEqual(representativeTemplate.nodes.map((node) => node.id));

    const branchEdge = graph.edges.find((edge) => edge.kind === 'branch' && edge.branchLabel === 'high_value');
    expect(branchEdge).toBeDefined();
    expect(branchEdge?.source).toBe('route_request');
    expect(branchEdge?.target).toBe('request_approval');
  });
});
