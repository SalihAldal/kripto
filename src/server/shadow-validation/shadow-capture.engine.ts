import { getDecisionLogByDecisionId } from "@/src/server/repositories/decision-log.repository";
import {
  listActiveShadowEngines,
  listShadowOnlyEngines,
  shouldRunEngineForTrafficWithAbTests,
} from "@/src/server/shadow-validation/engine-registry.service";
import { runShadowEngineAdapter } from "@/src/server/shadow-validation/shadow-engine-adapters.service";
import { compareDecisions } from "@/src/server/shadow-validation/decision-comparison.service";
import {
  persistDecisionDifference,
  persistShadowDecision,
} from "@/src/server/shadow-validation/shadow-validation.repository";
import { emitShadowValidationEvent } from "@/src/server/shadow-validation/shadow-validation.events";

export async function captureShadowDecisionsForDecision(decisionId: string) {
  const decision = await getDecisionLogByDecisionId(decisionId);
  if (!decision) return { decisionId, captured: 0 };

  const engines = await listActiveShadowEngines();
  const captures = [];
  let productionCapture = null as Awaited<ReturnType<typeof runShadowEngineAdapter>>;

  for (const engine of engines) {
    if (!(await shouldRunEngineForTrafficWithAbTests(engine, decisionId))) continue;
    const capture = await runShadowEngineAdapter(engine, decisionId);
    if (!capture) continue;
    await persistShadowDecision(capture);
    captures.push(capture);
    if (engine.mode === "PRODUCTION" || capture.isProduction) productionCapture = capture;
  }

  if (!productionCapture) {
    productionCapture = captures.find((row) => row.engineId === "production") ?? captures[0] ?? null;
  }

  if (productionCapture) {
    const shadows = await listShadowOnlyEngines();
    for (const engine of shadows) {
      if (!(await shouldRunEngineForTrafficWithAbTests(engine, decisionId))) continue;
      const shadowCapture = captures.find((row) => row.engineId === engine.engineId);
      if (!shadowCapture || shadowCapture.engineId === productionCapture.engineId) continue;
      const diff = compareDecisions(productionCapture, shadowCapture);
      if (diff.productionDecision !== diff.shadowDecision || (diff.confidenceDelta ?? 0) !== 0) {
        await persistDecisionDifference({
          ...diff,
          productionEngineId: productionCapture.engineId,
        });
      }
    }
  }

  emitShadowValidationEvent("shadow.captured", { decisionId, captured: captures.length });
  return { decisionId, captured: captures.length, engines: captures.map((row) => row.engineId) };
}

export async function evaluatePendingShadowDecisions(limit = 50) {
  const { listPendingShadowEvaluations, updateShadowDecisionEvaluation } = await import(
    "@/src/server/shadow-validation/shadow-validation.repository"
  );
  const { evaluateShadowOutcome } = await import("@/src/server/shadow-validation/outcome-evaluator.service");
  const pending = await listPendingShadowEvaluations(limit);
  let evaluated = 0;

  for (const row of pending) {
    const outcome = await evaluateShadowOutcome({
      symbol: row.symbol,
      decisionTime: row.capturedAt,
      entryPrice: row.entryPrice ?? undefined,
      decision: row.decision,
      productionDecision: row.productionDecision ?? undefined,
    });
    if (outcome.verdict === "PENDING") continue;
    await updateShadowDecisionEvaluation({
      decisionId: row.decisionId,
      engineId: row.engineId,
      verdict: outcome.verdict,
      profitPct: outcome.profitPct,
      metadata: { mfePct: outcome.mfePct, maePct: outcome.maePct, profitDeltaPct: outcome.profitDeltaPct },
    });
    evaluated += 1;
  }

  emitShadowValidationEvent("shadow.evaluated", { evaluated });
  return { evaluated };
}
