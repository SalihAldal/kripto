import { prisma } from "@/src/server/db/prisma";
import { persistKnowledgeEntry } from "@/src/server/learning-engine/learning-engine.repository";
import type { FalsePositiveType } from "@/src/server/learning-engine/learning-engine.types";

export async function learnFalsePositives(limit = 100) {
  const evaluations = await prisma.decisionEvaluation.findMany({
    where: { verdict: { in: ["FALSE_BUY", "FALSE_SELL", "WRONG", "MISSED_WINNER", "MISSED_BREAKOUT", "MISSED_PUMP"] } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  let stored = 0;
  for (const row of evaluations) {
    const log = await prisma.decisionLog.findUnique({ where: { decisionId: row.decisionId } });
    if (!log) continue;
    const type = classifyFalsePositive(log.decision, row.verdict ?? "", log.metadata);
    await persistKnowledgeEntry({
      title: `False Positive: ${type}`,
      category: "FALSE_POSITIVE",
      content: `${type} on ${log.symbol}. Decision=${log.decision} verdict=${row.verdict}`,
      tags: [type, log.symbol, "false-positive"],
      metadata: { decisionId: row.decisionId, type, verdict: row.verdict },
    }).catch(() => null);
    stored += 1;
  }
  return { evaluated: evaluations.length, stored };
}

function classifyFalsePositive(decision: string, verdict: string, metadata: unknown): FalsePositiveType {
  const meta = JSON.stringify(metadata ?? {}).toLowerCase();
  if (meta.includes("pump") || meta.includes("fake")) return "FAKE_PUMP";
  if (meta.includes("breakout")) return "FALSE_BREAKOUT";
  if (meta.includes("momentum")) return "FALSE_MOMENTUM";
  if (decision === "BUY" || verdict.includes("BUY")) return "BAD_BUY";
  if (decision === "SELL" || verdict.includes("SELL")) return "BAD_SELL";
  if (decision === "HOLD") return "BAD_HOLD";
  return "BAD_REJECT";
}
