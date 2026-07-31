import { prisma } from "@/src/server/db/prisma";
import { persistKnowledgeEntry } from "@/src/server/learning-engine/learning-engine.repository";
import type { MissedOpportunityType } from "@/src/server/learning-engine/learning-engine.types";

const TYPE_KEYWORDS: Record<MissedOpportunityType, string[]> = {
  BREAKOUT: ["breakout", "range break"],
  PUMP: ["pump", "surge", "spike"],
  TREND_START: ["trend start", "trend_begin"],
  CONTINUATION: ["continuation", "trend continue"],
  NEWS: ["news", "sentiment"],
  WHALE: ["whale", "large buy"],
  LIQUIDATION_CASCADE: ["liquidation", "cascade"],
};

export async function detectMissedOpportunities(limit = 100) {
  const rows = await prisma.missedOpportunity.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  let stored = 0;
  for (const row of rows) {
    const type = classifyMissedType(row);
    await persistKnowledgeEntry({
      title: `Missed ${type}: ${row.symbol}`,
      category: "MISSED_OPPORTUNITY",
      content: `Missed ${type} on ${row.symbol}. Profit=${row.missedProfitPct ?? 0}% reason=${row.reasonRejected ?? "unknown"}`,
      tags: [type, row.symbol, "missed"],
      metadata: { decisionId: row.decisionId, type, missedProfitPct: row.missedProfitPct },
    }).catch(() => null);
    stored += 1;
  }
  return { detected: rows.length, stored };
}

function classifyMissedType(row: { reasonRejected?: string | null; metadata?: unknown; symbol: string }): MissedOpportunityType {
  const text = `${row.reasonRejected ?? ""} ${JSON.stringify(row.metadata ?? {})}`.toLowerCase();
  for (const [type, keywords] of Object.entries(TYPE_KEYWORDS) as Array<[MissedOpportunityType, string[]]>) {
    if (keywords.some((keyword) => text.includes(keyword))) return type;
  }
  return "BREAKOUT";
}

export async function learnFromMissedOpportunities(limit = 100) {
  return detectMissedOpportunities(limit);
}
