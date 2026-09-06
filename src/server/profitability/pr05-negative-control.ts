import type { ExitPolicyId } from "@/src/server/profitability/pr04-types";
import type { MatchedEntryManifest } from "@/src/server/profitability/pr04-types";
import type { Pr04ExitReplayTick } from "@/src/server/profitability/pr04-replay";
import { buildMatchedEntryManifest } from "@/src/server/profitability/pr04-matched-entry-manifest";
import { computeNetExpectancyFromPnls } from "@/src/server/profitability/pr05-metrics";
import { runMatchedExitComparison } from "@/src/server/profitability/pr05-offline-comparison";
import { findMarketQuoteAtMs } from "@/src/server/profitability/pr05-replay-clock";
import { buildRiskReference } from "@/src/server/profitability/pr04-structural-stop";
import type { Pr05NegativeControlResult, Pr05TradeOutcome } from "@/src/server/profitability/pr05-types";

function computeMaxEntryShiftMs(input: {
  manifest: MatchedEntryManifest;
  marketTicks: Pr04ExitReplayTick[];
  minShiftMs: number;
  maxShiftMs: number;
}) {
  const windowSpan = input.manifest.replayWindow.toMs - input.manifest.entryAtMs;
  const futureTicks = input.marketTicks.filter((tick) => tick.observation.eventAtMs > input.manifest.entryAtMs);
  const earliestFutureAt =
    futureTicks.length > 0
      ? Math.min(...futureTicks.map((tick) => tick.observation.eventAtMs))
      : input.manifest.replayWindow.toMs;
  const tickBound = Math.max(0, earliestFutureAt - input.manifest.entryAtMs - 1);
  const windowBound = Math.max(0, windowSpan - 15_000);
  const effectiveMax = Math.min(input.maxShiftMs, tickBound, windowBound);
  return effectiveMax >= input.minShiftMs ? effectiveMax : null;
}

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** @deprecated Performance-only permutation; not a causal negative control. */
export function shuffleClosedPnlPermutation(input: {
  outcomes: Pr05TradeOutcome[];
  seed: number;
  iterations: number;
  shiftBlocks: number;
}) {
  const grouped = new Map<string, Pr05TradeOutcome[]>();
  for (const row of input.outcomes) {
    const arr = grouped.get(row.lifecycleId) ?? [];
    arr.push(row);
    grouped.set(row.lifecycleId, arr);
  }
  const blocks = [...grouped.keys()];
  const realPnls = input.outcomes.filter((o) => o.closed && o.netPnl != null).map((o) => o.netPnl!);
  const realNetExpectancy = computeNetExpectancyFromPnls(realPnls);
  if (!blocks.length || realNetExpectancy == null) {
    return {
      method: "PNL_PERMUTATION_NON_CAUSAL",
      seed: input.seed,
      iterations: input.iterations,
      realNetExpectancy,
      controlNetExpectancies: [] as number[],
      breaksDependency: false,
      verdict: "INSUFFICIENT_DATA" as const,
      reason: "NON_CAUSAL_PERF_CONTROL_ONLY",
      procedureApplied: false,
      implementationVerdict: "INSUFFICIENT_DATA" as const,
      significanceVerdict: "NOT_EVALUATED" as const,
    };
  }
  const rng = mulberry32(input.seed);
  const controlNetExpectancies: number[] = [];
  for (let i = 0; i < input.iterations; i += 1) {
    const shuffled = [...blocks];
    for (let j = shuffled.length - 1; j > 0; j -= 1) {
      const k = Math.floor(rng() * (j + 1));
      [shuffled[j], shuffled[k]] = [shuffled[k]!, shuffled[j]!];
    }
    const shift = Math.max(1, input.shiftBlocks % shuffled.length);
    const permuted = [...shuffled.slice(shift), ...shuffled.slice(0, shift)];
    const pnlByBlock = new Map<string, number[]>();
    for (const block of blocks) {
      const rows = grouped.get(block) ?? [];
      pnlByBlock.set(
        block,
        rows.filter((o) => o.closed && o.netPnl != null).map((o) => o.netPnl!),
      );
    }
    const permutedPnls: number[] = [];
    for (const block of permuted) permutedPnls.push(...(pnlByBlock.get(block) ?? []));
    const exp = computeNetExpectancyFromPnls(permutedPnls);
    if (exp != null) controlNetExpectancies.push(exp);
  }
  const controlMean =
    controlNetExpectancies.length > 0
      ? controlNetExpectancies.reduce((a, b) => a + b, 0) / controlNetExpectancies.length
      : null;
  const breaksDependency = controlMean != null && Math.abs(controlMean - realNetExpectancy) > 1e-9;
  return {
    method: "PNL_PERMUTATION_NON_CAUSAL",
    seed: input.seed,
    iterations: input.iterations,
    realNetExpectancy,
    controlNetExpectancies,
    breaksDependency,
    verdict: "INSUFFICIENT_DATA" as const,
    reason: "NON_CAUSAL_PERF_CONTROL_ONLY",
    procedureApplied: false,
    implementationVerdict: "INSUFFICIENT_DATA" as const,
    significanceVerdict: "NOT_EVALUATED" as const,
  };
}

export function buildCounterfactualEntryShift(input: {
  manifest: MatchedEntryManifest;
  marketTicks: Pr04ExitReplayTick[];
  shiftMs: number;
}) {
  const newEntryAt = input.manifest.entryAtMs + input.shiftMs;
  if (newEntryAt >= input.manifest.replayWindow.toMs) {
    return { status: "UNSUPPORTED" as const, reason: "SHIFT_OUTSIDE_REPLAY_WINDOW" };
  }
  const entryPrice = findMarketQuoteAtMs(input.marketTicks, newEntryAt);
  if (entryPrice == null || !Number.isFinite(entryPrice)) {
    return { status: "UNSUPPORTED" as const, reason: "NO_QUOTE_AT_SHIFTED_ENTRY" };
  }
  const totalQty = input.manifest.fills.reduce((acc, row) => acc + row.quantity, 0);
  const totalFee = input.manifest.fills.reduce((acc, row) => acc + row.fee, 0);
  const feeRate = totalQty > 0 && entryPrice > 0 ? totalFee / (totalQty * input.manifest.fills[0]!.price) : 0;
  const closeFee = Number((totalQty * entryPrice * feeRate).toFixed(8));
  const stopPrice = input.manifest.invalidation?.invalidationThreshold ?? entryPrice * 0.992;
  const shiftedManifest = buildMatchedEntryManifest({
    entrySignalId: `${input.manifest.entrySignalId}:nc:${input.shiftMs}`,
    strategyId: input.manifest.strategyId,
    entryPolicyVersion: input.manifest.entryPolicyVersion,
    entryAtMs: newEntryAt,
    fills: [{ price: entryPrice, quantity: totalQty, fee: closeFee, atMs: newEntryAt }],
    riskReference: buildRiskReference({
      entryPrice,
      initialStopPrice: stopPrice,
      initialQuantity: totalQty,
      entryFee: closeFee,
      includesFeesInBreakEven: true,
      computedAtMs: newEntryAt,
    }),
    invalidation: input.manifest.invalidation,
    featureEvidenceIds: input.manifest.featureEvidenceIds,
    dataSource: input.manifest.dataSource,
    replayWindow: { fromMs: newEntryAt, toMs: input.manifest.replayWindow.toMs },
    symbol: input.manifest.symbol ?? null,
    regime: input.manifest.regime ?? null,
  });
  const exitTicks = input.marketTicks.filter(
    (tick) =>
      tick.observation.eventAtMs >= newEntryAt &&
      tick.observation.eventAtMs <= input.manifest.replayWindow.toMs,
  );
  if (!exitTicks.length) {
    return { status: "UNSUPPORTED" as const, reason: "NO_EXIT_TICKS_AFTER_SHIFT" };
  }
  return {
    status: "OK" as const,
    manifest: shiftedManifest,
    exitTicks,
    marketTicksUnchanged: true,
    entryPrice,
  };
}

/** @deprecated Shifts market ticks — breaks causal negative control. Use buildCounterfactualEntryShift. */
export function shiftMatchedManifestEntryTime(input: {
  manifest: MatchedEntryManifest;
  ticks: Pr04ExitReplayTick[];
  shiftMs: number;
}) {
  const built = buildCounterfactualEntryShift({
    manifest: input.manifest,
    marketTicks: input.ticks,
    shiftMs: input.shiftMs,
  });
  if (built.status !== "OK") return null;
  return { manifest: built.manifest, ticks: built.exitTicks };
}

export function runCausalEntryShiftNegativeControl(input: {
  datasetId: string;
  manifests: MatchedEntryManifest[];
  ticksByManifestId: Record<string, Pr04ExitReplayTick[]>;
  policyIds?: ExitPolicyId[];
  seed: number;
  iterations: number;
  minShiftMs?: number;
  maxShiftMs?: number;
}): Pr05NegativeControlResult {
  const real = runMatchedExitComparison({
    datasetId: input.datasetId,
    manifests: input.manifests,
    ticksByManifestId: input.ticksByManifestId,
    policyIds: input.policyIds,
    recordedMarketData: false,
  });
  const realPnls = real.outcomes.filter((o) => o.closed && o.netPnl != null).map((o) => o.netPnl!);
  const realNetExpectancy = computeNetExpectancyFromPnls(realPnls);
  if (!input.manifests.length || realNetExpectancy == null) {
    return {
      method: "CAUSAL_ENTRY_TIME_SHIFT",
      seed: input.seed,
      iterations: input.iterations,
      realNetExpectancy,
      controlNetExpectancies: [],
      breaksDependency: false,
      verdict: "INSUFFICIENT_DATA",
      reason: "NO_CLOSED_TRADES",
      procedureApplied: false,
      matchedIterations: 0,
      unmatchedIterations: input.iterations,
      implementationVerdict: "INSUFFICIENT_DATA",
      significanceVerdict: "INSUFFICIENT_DATA",
      marketTimestampsPreserved: true,
    };
  }
  const rng = mulberry32(input.seed);
  const controlNetExpectancies: number[] = [];
  let matchedIterations = 0;
  let unmatchedIterations = 0;
  const minShift = input.minShiftMs ?? 30_000;
  const maxShift = input.maxShiftMs ?? 120_000;
  for (let i = 0; i < input.iterations; i += 1) {
    const shiftedManifests: MatchedEntryManifest[] = [];
    const shiftedTicks: Record<string, Pr04ExitReplayTick[]> = {};
    let iterationOk = true;
    for (const manifest of input.manifests) {
      const marketTicks = input.ticksByManifestId[manifest.manifestId] ?? [];
      const effectiveMax = computeMaxEntryShiftMs({
        manifest,
        marketTicks,
        minShiftMs: minShift,
        maxShiftMs: maxShift,
      });
      if (effectiveMax == null) {
        iterationOk = false;
        break;
      }
      const shiftMs = minShift + Math.floor(rng() * Math.max(1, effectiveMax - minShift));
      const built = buildCounterfactualEntryShift({ manifest, marketTicks, shiftMs });
      if (built.status !== "OK") {
        iterationOk = false;
        break;
      }
      shiftedManifests.push(built.manifest);
      shiftedTicks[built.manifest.manifestId] = built.exitTicks;
    }
    if (!iterationOk) {
      unmatchedIterations += 1;
      continue;
    }
    const control = runMatchedExitComparison({
      datasetId: input.datasetId,
      manifests: shiftedManifests,
      ticksByManifestId: shiftedTicks,
      policyIds: input.policyIds,
      recordedMarketData: false,
    });
    const pnls = control.outcomes.filter((o) => o.closed && o.netPnl != null).map((o) => o.netPnl!);
    const exp = computeNetExpectancyFromPnls(pnls);
    if (exp != null) {
      controlNetExpectancies.push(exp);
      matchedIterations += 1;
    } else {
      unmatchedIterations += 1;
    }
  }
  const controlMean =
    controlNetExpectancies.length > 0
      ? controlNetExpectancies.reduce((a, b) => a + b, 0) / controlNetExpectancies.length
      : null;
  const distributionDiffers =
    controlMean != null ? Math.abs(controlMean - realNetExpectancy) > 1e-9 : null;
  const procedureApplied = matchedIterations > 0;
  const implementationVerdict = procedureApplied ? "PASS" : "INSUFFICIENT_DATA";
  let significanceVerdict: Pr05NegativeControlResult["significanceVerdict"] = "INSUFFICIENT_DATA";
  if (controlNetExpectancies.length >= 3 && distributionDiffers != null) {
    significanceVerdict = distributionDiffers ? "DIFFERS" : "NOT_DIFFERENT";
  }
  let verdict: Pr05NegativeControlResult["verdict"] = "INSUFFICIENT_DATA";
  if (procedureApplied) {
    verdict = implementationVerdict === "PASS" ? "PASS" : "INSUFFICIENT_DATA";
  }
  return {
    method: "CAUSAL_ENTRY_TIME_SHIFT",
    seed: input.seed,
    iterations: input.iterations,
    realNetExpectancy,
    controlNetExpectancies,
    breaksDependency: distributionDiffers === true,
    verdict,
    reason: procedureApplied ? "CAUSAL_CONTROL_EXECUTED" : "INSUFFICIENT_MATCHED_CONTROL_ITERATIONS",
    procedureApplied,
    matchedIterations,
    unmatchedIterations,
    distributionDiffers,
    implementationVerdict,
    significanceVerdict,
    marketTimestampsPreserved: true,
  };
}

export function detectFutureDataLeakFixture(input: {
  decisionAtMs: number;
  observationAvailableAtMs: number;
}) {
  return input.observationAvailableAtMs > input.decisionAtMs;
}

/** Backward-compatible alias; prefer runCausalEntryShiftNegativeControl. */
export const shiftSignalBlocksWithSeed = shuffleClosedPnlPermutation;
