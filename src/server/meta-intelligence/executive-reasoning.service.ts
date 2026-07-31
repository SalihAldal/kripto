import { getLatestContext, persistExecutiveSummary } from "@/src/server/meta-intelligence/meta-intelligence.repository";
import { calibrateConfidence } from "@/src/server/meta-intelligence/confidence-calibration.service";
import { resolveConflicts } from "@/src/server/meta-intelligence/conflict-resolver.service";

export async function generateExecutiveReasoning(contextId?: string) {
  const ctx = contextId
    ? await import("@/src/server/db/prisma").then(({ prisma }) => prisma.metaContext.findUnique({ where: { id: contextId } }))
    : await getLatestContext();

  const confidence = await calibrateConfidence(ctx?.id);
  const conflict = await resolveConflicts(ctx?.id);

  const regime = ctx?.marketRegime ?? "UNKNOWN";
  const recommendation = conflict.recommendation ?? "WAIT";

  const reasoning = [
    `Market regime assessed as ${regime}.`,
    `Overall confidence: ${confidence.overallConfidence}% (data: ${confidence.dataConfidence}%, market: ${confidence.marketConfidence}%).`,
    conflict.decision?.conflictSummary ? `Signal conflicts: ${conflict.decision.conflictSummary}.` : "",
    `Resolution: ${conflict.decision?.resolution ?? "Pending further data"}.`,
    `Executive recommendation: ${recommendation}.`,
    "No production systems were modified — this is coordination intelligence only.",
  ].filter(Boolean).join(" ");

  const whyNotWhat = `We recommend ${recommendation} because ${conflict.decision?.resolution ?? "intelligence sources have not converged"}, not because of price prediction. The Meta AI coordinates subsystem intelligence rather than forecasting markets directly.`;

  const summary = await persistExecutiveSummary({
    contextId: ctx?.id,
    summaryType: "EXECUTIVE_REASONING",
    title: `Executive Assessment — ${regime}`,
    executiveSummary: recommendation,
    reasoning,
    whyNotWhat,
    keyInsights: [
      `Regime: ${regime}`,
      `Confidence: ${confidence.overallConfidence}%`,
      `Conflicts resolved: ${conflict.signals?.length ?? 0} signals`,
    ],
  });

  return { summary, confidence, recommendation, reasoning };
}
