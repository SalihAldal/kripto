import { prisma } from "@/src/server/db/prisma";
import { detectMarketRegime } from "@/src/server/strategy-selector/regime-detection.service";
import { classifyCoin } from "@/src/server/strategy-selector/coin-classification.service";
import { scoreAllStrategies } from "@/src/server/strategy-selector/strategy-scoring.service";
import { selectStrategy, computeStrategyConfidence } from "@/src/server/strategy-selector/strategy-selection.service";
import { validateStrategySelection } from "@/src/server/strategy-selector/selection-validation.service";
import { persistStrategySelection } from "@/src/server/strategy-selector/strategy-selector.repository";
import { emitStrategySelectorEvent, STRATEGY_SELECTOR_EVENT } from "@/src/server/strategy-selector/strategy-selector.events";
import { ensureStrategyProfiles } from "@/src/server/strategy-selector/strategy-profile-bootstrap.service";

export async function runStrategySelection(symbol: string) {
  await ensureStrategyProfiles();

  const sym = symbol.toUpperCase();
  const regime = await detectMarketRegime(sym);
  const coinClass = await classifyCoin(sym);
  const rankings = await scoreAllStrategies(sym, regime, coinClass);
  const selection = selectStrategy(rankings, regime.regimeLabel, coinClass);
  const confidence = computeStrategyConfidence(rankings[0]!);

  const snapshot = await prisma.marketSnapshot.findFirst({
    where: { symbol: sym },
    orderBy: { snapshotAt: "desc" },
  });
  const snapshotAgeMs = snapshot ? Date.now() - snapshot.snapshotAt.getTime() : 999_999;
  const validation = validateStrategySelection(regime, rankings[0]!, snapshotAgeMs);

  const profile = await prisma.adaptiveStrategyProfile.findUnique({
    where: { strategyType: selection.primaryStrategy },
  });

  const record = await persistStrategySelection({
    symbol: sym,
    regimeId: regime.id,
    coinClassification: coinClass,
    primaryStrategy: selection.primaryStrategy,
    secondaryStrategy: selection.secondaryStrategy,
    rejectedStrategies: selection.rejectedStrategies,
    primaryProfileId: profile?.id,
    strategyConfidence: confidence.strategyConfidence,
    expectedSuccess: confidence.expectedSuccess,
    expectedRisk: confidence.expectedRisk,
    expectedHoldMinutes: confidence.expectedHoldMinutes,
    expectedVolatility: confidence.expectedVolatility,
    reasoningSummary: selection.reasoningSummary,
    validationPassed: validation.passed,
    validationDetails: validation,
    rankings: selection.rankings,
  });

  emitStrategySelectorEvent(STRATEGY_SELECTOR_EVENT.STRATEGY_SELECTED, {
    selectionKey: record.selectionKey,
    symbol: sym,
    primaryStrategy: selection.primaryStrategy,
  });
  emitStrategySelectorEvent(STRATEGY_SELECTOR_EVENT.VALIDATION_COMPLETED, { passed: validation.passed, symbol: sym });

  return { selection: record, regime, coinClass, rankings, confidence, validation };
}

export async function selectForCandidateSymbols(limit = 8) {
  const [decisions, snapshots] = await Promise.all([
    prisma.decisionLog.findMany({ where: { decision: { in: ["BUY", "EXECUTE", "LONG"] } }, orderBy: { createdAt: "desc" }, take: limit, select: { symbol: true } }).catch(() => []),
    prisma.marketSnapshot.findMany({ orderBy: { snapshotAt: "desc" }, take: limit * 2, select: { symbol: true } }).catch(() => []),
  ]);
  const symbols = [...new Set([...decisions.map((d) => d.symbol), ...snapshots.map((s) => s.symbol).filter(Boolean) as string[]])].slice(0, limit);
  const results = [];
  for (const symbol of symbols) {
    try {
      results.push(await runStrategySelection(symbol));
    } catch { /* skip */ }
  }
  return { selected: results.length, results };
}
