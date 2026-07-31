import { upsertStrategicObjective } from "@/src/server/meta-intelligence/meta-intelligence.repository";
import { prisma } from "@/src/server/db/prisma";
import type { StrategicObjectiveType } from "@prisma/client";

const OBJECTIVES: Array<{ type: StrategicObjectiveType; name: string; description: string }> = [
  { type: "CAPITAL_PRESERVATION", name: "Capital Preservation", description: "Protect portfolio capital during adverse conditions" },
  { type: "GROWTH", name: "Portfolio Growth", description: "Maximize risk-adjusted returns over long term" },
  { type: "RISK_CONTROL", name: "Risk Control", description: "Maintain exposure within defined risk limits" },
  { type: "PORTFOLIO_STABILITY", name: "Portfolio Stability", description: "Minimize drawdown volatility" },
  { type: "LEARNING_SPEED", name: "Learning Velocity", description: "Accelerate system learning from outcomes" },
  { type: "EXECUTION_RELIABILITY", name: "Execution Reliability", description: "Ensure consistent and safe order execution" },
];

export async function trackStrategicObjectives() {
  const [engHealth, openPositions, learningJobs] = await Promise.all([
    prisma.engineeringHealth.findFirst({ orderBy: { scoredAt: "desc" } }),
    prisma.position.count({ where: { status: "OPEN" } }).catch(() => 0),
    prisma.learningEngineJobState.count().catch(() => 0),
  ]);

  const scores: Record<StrategicObjectiveType, number> = {
    CAPITAL_PRESERVATION: Math.max(40, 100 - openPositions * 3),
    GROWTH: 55,
    RISK_CONTROL: openPositions > 10 ? 45 : 75,
    PORTFOLIO_STABILITY: Math.max(30, 90 - openPositions * 4),
    LEARNING_SPEED: Math.min(100, learningJobs * 15 + 40),
    EXECUTION_RELIABILITY: engHealth?.reliabilityScore ?? 70,
  };

  const results = [];
  for (const obj of OBJECTIVES) {
    const row = await upsertStrategicObjective({
      objectiveType: obj.type,
      name: obj.name,
      description: obj.description,
      targetScore: 80,
      currentScore: scores[obj.type],
    });
    results.push(row);
  }
  return { objectives: results };
}
