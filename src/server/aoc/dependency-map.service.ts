import { persistServiceDependency } from "@/src/server/aoc/aoc.repository";

const NODES = [
  { id: "scanner", label: "Scanner", type: "WORKER" },
  { id: "decision-engine", label: "Decision Engine", type: "WORKER" },
  { id: "execution", label: "Execution", type: "WORKER" },
  { id: "risk-engine", label: "Risk Engine", type: "SERVICE" },
  { id: "learning-engine", label: "Learning Engine", type: "WORKER" },
  { id: "exchange-abstraction", label: "Exchange Abstraction", type: "SERVICE" },
  { id: "event-platform", label: "Event Platform", type: "SERVICE" },
  { id: "intelligence-fusion", label: "Intelligence Fusion", type: "SERVICE" },
  { id: "meta-intelligence", label: "Meta AI", type: "SERVICE" },
  { id: "redis", label: "Redis", type: "INFRA" },
  { id: "postgres", label: "PostgreSQL", type: "INFRA" },
  { id: "binance", label: "Binance", type: "EXTERNAL" },
  { id: "aoc", label: "AOC", type: "MONITOR" },
];

const EDGES = [
  { from: "scanner", to: "decision-engine", type: "DATA" },
  { from: "decision-engine", to: "risk-engine", type: "SYNC" },
  { from: "risk-engine", to: "execution", type: "SYNC" },
  { from: "execution", to: "exchange-abstraction", type: "SYNC" },
  { from: "exchange-abstraction", to: "binance", type: "EXTERNAL" },
  { from: "decision-engine", to: "event-platform", type: "ASYNC" },
  { from: "execution", to: "event-platform", type: "ASYNC" },
  { from: "intelligence-fusion", to: "decision-engine", type: "DATA" },
  { from: "meta-intelligence", to: "decision-engine", type: "DATA" },
  { from: "learning-engine", to: "decision-engine", type: "DATA" },
  { from: "event-platform", to: "redis", type: "INFRA" },
  { from: "scanner", to: "redis", type: "INFRA" },
  { from: "decision-engine", to: "postgres", type: "INFRA" },
  { from: "execution", to: "postgres", type: "INFRA" },
  { from: "aoc", to: "scanner", type: "OBSERVE" },
  { from: "aoc", to: "exchange-abstraction", type: "OBSERVE" },
  { from: "aoc", to: "event-platform", type: "OBSERVE" },
];

const CRITICAL_PATH = [
  { step: 1, node: "scanner", role: "Market data ingestion" },
  { step: 2, node: "decision-engine", role: "Trade decision" },
  { step: 3, node: "risk-engine", role: "Risk validation" },
  { step: 4, node: "execution", role: "Order placement" },
  { step: 5, node: "exchange-abstraction", role: "Exchange routing" },
  { step: 6, node: "binance", role: "External execution" },
];

export async function buildDependencyMap() {
  return persistServiceDependency(NODES, EDGES, CRITICAL_PATH);
}

export function getServiceGraph() {
  return { nodes: NODES, edges: EDGES, criticalPath: CRITICAL_PATH };
}

export function getFailurePropagation(failedNodeId: string) {
  const downstream = new Set<string>();
  const queue = [failedNodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of EDGES) {
      if (edge.from === current && edge.type !== "OBSERVE" && !downstream.has(edge.to)) {
        downstream.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return { failedNode: failedNodeId, affectedNodes: [...downstream] };
}
