import { prisma } from "@/src/server/db/prisma";
import { buildPricePath } from "@/src/server/replay/price-path.service";
import { persistMissedOpportunity } from "@/src/server/performance-optimizer/performance-optimizer.repository";
import { emitPerfOptEvent, PERF_OPT_EVENT } from "@/src/server/performance-optimizer/performance-optimizer.events";

export async function analyzeMissedOpportunities(limit = 20) {
  const rejects = await prisma.decisionLog.findMany({
    where: { decision: { in: ["REJECT", "REJECTED", "SKIP"] } },
    orderBy: { createdAt: "desc" },
    take: limit,
  }).catch(() => []);

  const results = [];
  for (const dec of rejects) {
    const pricePath = await buildPricePath({ symbol: dec.symbol, decisionTime: dec.createdAt }).catch(() => null);
    if (!pricePath || pricePath.candles.length === 0) continue;

    const entry = pricePath.priceAtDecision;
    const highest = Math.max(...pricePath.candles.map((c) => c.high), entry);
    const maxPossibleProfitPct = entry > 0 ? ((highest - entry) / entry) * 100 : 0;
    if (maxPossibleProfitPct < 0.5) continue;

    const rejectReason = Array.isArray(dec.rejectReasons) ? String(dec.rejectReasons) : dec.decision;
    const record = await persistMissedOpportunity({
      symbol: dec.symbol.toUpperCase(),
      decisionId: dec.decisionId,
      scannerPassed: true,
      wasRejected: true,
      maxPossibleProfitPct: Number(maxPossibleProfitPct.toFixed(4)),
      actualProfitPct: 0,
      missedProfitPct: Number(maxPossibleProfitPct.toFixed(4)),
      rejectReason,
      confidence: dec.confidence,
    });
    results.push(record);
    emitPerfOptEvent(PERF_OPT_EVENT.MISSED_OPPORTUNITY_FOUND, { symbol: dec.symbol, missedProfitPct: maxPossibleProfitPct });
  }
  return { analyzed: results.length, opportunities: results };
}
