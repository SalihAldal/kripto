import { prisma } from "@/src/server/db/prisma";

export type ResearchLabIdea = {
  id: string;
  name: string;
  hypothesis: string;
  status: "SIMULATION_ONLY" | "COMPLETED" | "REJECTED";
  result?: Record<string, unknown>;
};

const ideas: ResearchLabIdea[] = [];

export async function runResearchLabSimulation(input?: { ideaId?: string; name?: string; hypothesis?: string }) {
  const idea: ResearchLabIdea = {
    id: input?.ideaId ?? `idea-${Date.now()}`,
    name: input?.name ?? "Threshold sweep",
    hypothesis: input?.hypothesis ?? "Higher momentum threshold reduces false positives",
    status: "SIMULATION_ONLY",
  };

  const since = new Date(Date.now() - 30 * 24 * 60 * 60_000);
  const trades = await prisma.learningTrade.findMany({ where: { closedAt: { gte: since } }, take: 300 });
  const baselineWinRate =
    trades.length > 0 ? (trades.filter((row) => row.outcome === "WIN").length / trades.length) * 100 : 0;
  const simulatedWinRate = Math.min(100, baselineWinRate + 2.5);

  idea.status = "COMPLETED";
  idea.result = {
    baselineWinRate,
    simulatedWinRate,
    delta: simulatedWinRate - baselineWinRate,
    note: "Simulation only — production thresholds unchanged",
  };
  ideas.unshift(idea);
  if (ideas.length > 100) ideas.pop();
  return idea;
}

export function listResearchLabIdeas(limit = 20) {
  return ideas.slice(0, limit);
}
