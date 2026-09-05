import type {
  AdaptiveRelaxation,
  ClassifiedFilterHit,
  EntryDecisionExplanation,
  FilterPriority,
} from "@/src/server/execution/entry-decision.types";

const CRITICAL_PATTERNS = [
  /ai sell/i,
  /learning memory block/i,
  /dump tespiti/i,
  /sert satis/i,
  /role.*veto/i,
  /ai-3 veto/i,
  /risk veto/i,
  /open position/i,
  /emergency stop/i,
  /safe mode/i,
  /spread .* > 0\.[4-9]/i,
  /fake spike .* > [3-9]/i,
  /volatilite .* > [6-9]/i,
];

const IMPORTANT_PATTERNS = [
  /confidence .*?</i,
  /scanner .*?</i,
  /non-pump kalite/i,
  /kalite skoru dusuk/i,
  /ai role consensus zayif/i,
  /ai karar zayif/i,
  /pump zayif ai/i,
  /steady-gain kalite/i,
  /last-resort composite/i,
  /momentum breakout chop/i,
  /net hedef edge/i,
  /risk .* > /i,
  /pump risk .* > /i,
  /tape yetersiz/i,
  /pump hour-only/i,
  /pump LATE/i,
  /pump CALM/i,
  /pump RANGE zayif/i,
  /pump ROCKET zayif/i,
];

export function classifyFilterReason(reason: string): FilterPriority {
  const text = reason.trim();
  if (!text) return "ADVISORY";
  if (CRITICAL_PATTERNS.some((pattern) => pattern.test(text))) return "CRITICAL";
  if (IMPORTANT_PATTERNS.some((pattern) => pattern.test(text))) return "IMPORTANT";
  return "ADVISORY";
}

export function computeAdaptiveRelaxation(consecutiveRejections: number): AdaptiveRelaxation {
  const tier = Math.max(0, Math.floor(Math.max(0, consecutiveRejections)));
  return {
    tier,
    minConfidenceDelta: 0,
    minQualityScoreDelta: 0,
    minScannerScoreDelta: 0,
    minScannerConfidenceDelta: 0,
    compositeFloorRelax: 0,
    advisoryStackLimit: 4,
    explorationMode: false,
  };
}

export function applyAdaptiveThresholds(input: {
  baseMinConfidence: number;
  baseMinQualityScore: number;
  baseMinScannerScore: number;
  baseMinScannerConfidence: number;
  consecutiveRejections: number;
}) {
  const relaxation = computeAdaptiveRelaxation(input.consecutiveRejections);
  return {
    relaxation,
    minConfidence: Math.max(32, input.baseMinConfidence + relaxation.minConfidenceDelta),
    minQualityScore: Math.max(35, input.baseMinQualityScore + relaxation.minQualityScoreDelta),
    minScannerScore: Math.max(30, input.baseMinScannerScore + relaxation.minScannerScoreDelta),
    minScannerConfidence: Math.max(28, input.baseMinScannerConfidence + relaxation.minScannerConfidenceDelta),
  };
}

function wouldPassIfRelaxed(input: {
  importantBlockers: string[];
  advisoryBlockers: string[];
  compositeAvg: number;
}) {
  return (
    input.importantBlockers.length <= 1 &&
    input.advisoryBlockers.length <= 2 &&
    input.compositeAvg >= 48
  );
}

export function resolveAdaptiveEntryDecision(input: {
  reasons: string[];
  compositeAvg: number;
  consecutiveRejections: number;
  dataDegraded?: boolean;
  confidence: number;
  effectiveConfidenceFloor: number;
  effectiveQualityFloor: number;
}): EntryDecisionExplanation {
  const relaxation = computeAdaptiveRelaxation(input.consecutiveRejections);
  const classified: ClassifiedFilterHit[] = input.reasons
    .filter(Boolean)
    .map((reason) => ({ reason, priority: classifyFilterReason(reason) }));

  const criticalBlockers = classified.filter((row) => row.priority === "CRITICAL").map((row) => row.reason);
  const importantBlockers = classified.filter((row) => row.priority === "IMPORTANT").map((row) => row.reason);
  let advisoryBlockers = classified.filter((row) => row.priority === "ADVISORY").map((row) => row.reason);
  const waivedBlockers: string[] = [];

  if (input.dataDegraded) {
    for (const reason of [...importantBlockers, ...advisoryBlockers]) {
      if (
        /mtf .*?</i.test(reason) ||
        /momentum\/flow zayif/i.test(reason) ||
        /regime chop/i.test(reason) ||
        /regime lifecycle/i.test(reason) ||
        /sahte hour-only pump/i.test(reason)
      ) {
        waivedBlockers.push(reason);
      }
    }
    advisoryBlockers = advisoryBlockers.filter((row) => !waivedBlockers.includes(row));
  }

  if (criticalBlockers.length > 0) {
    return {
      ok: false,
      primaryBlocker: criticalBlockers[0],
      secondaryBlockers: [...criticalBlockers.slice(1), ...importantBlockers, ...advisoryBlockers],
      criticalBlockers,
      importantBlockers,
      advisoryBlockers,
      waivedBlockers,
      wouldPassWithRelaxedThresholds: wouldPassIfRelaxed({
        importantBlockers,
        advisoryBlockers,
        compositeAvg: input.compositeAvg,
      }),
      relaxation,
      effectiveConfidenceFloor: input.effectiveConfidenceFloor,
      effectiveQualityFloor: input.effectiveQualityFloor,
      compositeAvg: input.compositeAvg,
      advisoryStackCount: advisoryBlockers.length,
    };
  }

  const remainingImportant = [...importantBlockers];
  const remainingAdvisory = [...advisoryBlockers];

  const advisoryStackCount = remainingAdvisory.length;
  const ok = remainingImportant.length === 0 && advisoryStackCount <= relaxation.advisoryStackLimit;

  const blockers = [...remainingImportant, ...remainingAdvisory];
  return {
    ok,
    primaryBlocker: ok ? null : blockers[0] ?? null,
    secondaryBlockers: ok ? [] : blockers.slice(1),
    criticalBlockers,
    importantBlockers: remainingImportant,
    advisoryBlockers: remainingAdvisory,
    waivedBlockers,
    wouldPassWithRelaxedThresholds: wouldPassIfRelaxed({
      importantBlockers: remainingImportant,
      advisoryBlockers: remainingAdvisory,
      compositeAvg: input.compositeAvg,
    }),
    relaxation,
    effectiveConfidenceFloor: input.effectiveConfidenceFloor,
    effectiveQualityFloor: input.effectiveQualityFloor,
    compositeAvg: input.compositeAvg,
    advisoryStackCount,
  };
}

export function summarizeEntryDecisionForMetadata(decision: EntryDecisionExplanation) {
  return {
    ok: decision.ok,
    primaryBlocker: decision.primaryBlocker,
    secondaryBlockers: decision.secondaryBlockers,
    criticalBlockers: decision.criticalBlockers,
    importantBlockers: decision.importantBlockers,
    advisoryBlockers: decision.advisoryBlockers,
    waivedBlockers: decision.waivedBlockers,
    wouldPassWithRelaxedThresholds: decision.wouldPassWithRelaxedThresholds,
    relaxationTier: decision.relaxation.tier,
    explorationMode: decision.relaxation.explorationMode,
    effectiveConfidenceFloor: decision.effectiveConfidenceFloor,
    effectiveQualityFloor: decision.effectiveQualityFloor,
    advisoryStackCount: decision.advisoryStackCount,
  };
}
