import {
  AgentTemplate,
  AgentTemplateNode,
  ConditionNode,
  LLMStepConfig,
  LLMStepNode,
  ServiceCallConfig,
  ServiceCallNode,
  StructuredParserConfig,
  StructuredParserNode,
  TerminalResponseConfig,
  UserInterruptConfig,
  UserInterruptNode,
  cloneTemplate,
} from './agent-template.models';

export type GraphEdgeKind = 'next' | 'on_failure' | 'branch';

interface GraphBaseNode {
  id: string;
  description?: string | null;
}

export interface StructuredParserGraphNode extends GraphBaseNode {
  type: 'structured_parser';
  config: StructuredParserConfig;
}

export interface ConditionGraphNode extends GraphBaseNode {
  type: 'condition';
  config: ConditionNode['config'];
}

export interface ServiceCallGraphNode extends GraphBaseNode {
  type: 'service_call';
  config: ServiceCallConfig;
}

export interface UserInterruptGraphNode extends GraphBaseNode {
  type: 'user_interrupt';
  config: UserInterruptConfig;
}

export interface LLMStepGraphNode extends GraphBaseNode {
  type: 'llm_step';
  config: LLMStepConfig;
}

export interface TerminalResponseGraphNode extends GraphBaseNode {
  type: 'terminal_response';
  config: TerminalResponseConfig;
}

export type AgentGraphNode =
  | StructuredParserGraphNode
  | ConditionGraphNode
  | ServiceCallGraphNode
  | UserInterruptGraphNode
  | LLMStepGraphNode
  | TerminalResponseGraphNode;

export interface AgentGraphEdge {
  id: string;
  kind: GraphEdgeKind;
  source: string;
  target: string;
  branchLabel?: string;
}

export interface AgentTemplateGraph {
  templateVersion: string;
  entryNodeId: string;
  guardrails: AgentTemplate['guardrails'];
  nodes: AgentGraphNode[];
  edges: AgentGraphEdge[];
}

export function templateToGraph(template: AgentTemplate): AgentTemplateGraph {
  const cloned = cloneTemplate(template);
  const graphNodes = cloned.nodes.map<AgentGraphNode>((node) => {
    switch (node.type) {
      case 'structured_parser':
        return {
          id: node.id,
          type: node.type,
          description: node.description,
          config: node.config,
        };
      case 'condition':
        return {
          id: node.id,
          type: node.type,
          description: node.description,
          config: node.config,
        };
      case 'service_call':
        return {
          id: node.id,
          type: node.type,
          description: node.description,
          config: node.config,
        };
      case 'user_interrupt':
        return {
          id: node.id,
          type: node.type,
          description: node.description,
          config: node.config,
        };
      case 'llm_step':
        return {
          id: node.id,
          type: node.type,
          description: node.description,
          config: node.config,
        };
      case 'terminal_response':
        return {
          id: node.id,
          type: node.type,
          description: node.description,
          config: node.config,
        };
      default:
        throw new Error(`Unsupported template node type: ${(node as AgentTemplateNode).type}`);
    }
  });

  const graphEdges: AgentGraphEdge[] = [];
  for (const node of cloned.nodes) {
    pushLinearEdges(graphEdges, node);
  }

  return {
    templateVersion: cloned.template_version,
    entryNodeId: cloned.entry_node,
    guardrails: cloned.guardrails,
    nodes: graphNodes,
    edges: graphEdges,
  };
}

export function graphToTemplate(graph: AgentTemplateGraph): AgentTemplate {
  const edgesBySource = buildEdgesBySource(graph.edges);
  const nodes = graph.nodes.map<AgentTemplateNode>((node) => {
    switch (node.type) {
      case 'structured_parser':
        return {
          id: node.id,
          type: 'structured_parser',
          description: node.description,
          config: cloneJson(node.config) as StructuredParserNode['config'],
          next: getSingleEdge(edgesBySource, node.id, 'next').target,
          ...(getOptionalEdge(edgesBySource, node.id, 'on_failure')
            ? { on_failure: getOptionalEdge(edgesBySource, node.id, 'on_failure')?.target }
            : {}),
        };
      case 'service_call':
        return {
          id: node.id,
          type: 'service_call',
          description: node.description,
          config: cloneJson(node.config) as ServiceCallNode['config'],
          next: getSingleEdge(edgesBySource, node.id, 'next').target,
          ...(getOptionalEdge(edgesBySource, node.id, 'on_failure')
            ? { on_failure: getOptionalEdge(edgesBySource, node.id, 'on_failure')?.target }
            : {}),
        };
      case 'llm_step':
        return {
          id: node.id,
          type: 'llm_step',
          description: node.description,
          config: cloneJson(node.config) as LLMStepNode['config'],
          next: getSingleEdge(edgesBySource, node.id, 'next').target,
          ...(getOptionalEdge(edgesBySource, node.id, 'on_failure')
            ? { on_failure: getOptionalEdge(edgesBySource, node.id, 'on_failure')?.target }
            : {}),
        };
      case 'user_interrupt':
        return {
          id: node.id,
          type: 'user_interrupt',
          description: node.description,
          config: cloneJson(node.config) as UserInterruptNode['config'],
          next: getSingleEdge(edgesBySource, node.id, 'next').target,
        };
      case 'condition': {
        const branches = getBranchEdges(edgesBySource, node.id);
        const branchMap: Record<string, string> = {};
        for (const edge of branches) {
          if (!edge.branchLabel) {
            continue;
          }
          branchMap[edge.branchLabel] = edge.target;
        }

        return {
          id: node.id,
          type: 'condition',
          description: node.description,
          config: cloneJson(node.config) as ConditionNode['config'],
          branches: branchMap,
        };
      }
      case 'terminal_response':
        return {
          id: node.id,
          type: 'terminal_response',
          description: node.description,
          config: cloneJson(node.config) as TerminalResponseConfig,
        };
      default:
        throw new Error(`Unsupported graph node type: ${(node as AgentGraphNode).type}`);
    }
  });

  return {
    template_version: graph.templateVersion,
    entry_node: graph.entryNodeId,
    guardrails: cloneJson(graph.guardrails),
    nodes,
  };
}

function pushLinearEdges(edges: AgentGraphEdge[], node: AgentTemplateNode) {
  if (node.type === 'condition') {
    for (const [branchLabel, target] of Object.entries(node.branches)) {
      edges.push({
        id: buildEdgeId('branch', node.id, target, branchLabel),
        kind: 'branch',
        source: node.id,
        target,
        branchLabel,
      });
    }
    return;
  }

  if (node.type === 'terminal_response') {
    return;
  }

  edges.push({
    id: buildEdgeId('next', node.id, node.next),
    kind: 'next',
    source: node.id,
    target: node.next,
  });

  if (hasFailureEdge(node) && node.on_failure) {
    edges.push({
      id: buildEdgeId('on_failure', node.id, node.on_failure),
      kind: 'on_failure',
      source: node.id,
      target: node.on_failure,
    });
  }
}

function buildEdgesBySource(edges: AgentGraphEdge[]) {
  return edges.reduce<Record<string, AgentGraphEdge[]>>((accumulator, edge) => {
    const existing = accumulator[edge.source] ?? [];
    accumulator[edge.source] = [...existing, edge];
    return accumulator;
  }, {});
}

function getSingleEdge(edgesBySource: Record<string, AgentGraphEdge[]>, nodeId: string, kind: GraphEdgeKind) {
  const edges = (edgesBySource[nodeId] ?? []).filter((edge) => edge.kind === kind);
  if (edges.length === 0) {
    throw new Error(`Graph node '${nodeId}' is missing required '${kind}' edge.`);
  }
  return edges[0];
}

function getOptionalEdge(edgesBySource: Record<string, AgentGraphEdge[]>, nodeId: string, kind: GraphEdgeKind) {
  return (edgesBySource[nodeId] ?? []).find((edge) => edge.kind === kind);
}

function getBranchEdges(edgesBySource: Record<string, AgentGraphEdge[]>, nodeId: string) {
  return (edgesBySource[nodeId] ?? []).filter((edge) => edge.kind === 'branch');
}

function hasFailureEdge(node: AgentTemplateNode): node is StructuredParserNode | ServiceCallNode | LLMStepNode {
  return node.type === 'structured_parser' || node.type === 'service_call' || node.type === 'llm_step';
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildEdgeId(kind: GraphEdgeKind, source: string, target: string, branchLabel?: string) {
  if (kind === 'branch') {
    return `${source}::${kind}::${branchLabel ?? 'branch'}::${target}`;
  }

  return `${source}::${kind}::${target}`;
}

