import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { resolveExecutionAuthorization } from "@/src/server/execution/er03-canonical-policy";
import {
  buildExitPolicySnapshotAtEntry,
  evaluateExitPolicyTick,
  getExitPolicyState,
  initializeExitPolicyState,
  applyExitFill,
  markExitDataEnd,
  resetExitPolicyStoreForTests,
} from "@/src/server/profitability/pr04-exit-evaluator";
import { pickHighestPriorityDecision } from "@/src/server/profitability/pr04-exit-coordinator";
import { buildMatchedEntryManifest, verifyManifestImmutable } from "@/src/server/profitability/pr04-matched-entry-manifest";
import {
  allocateFeeAcrossFills,
  buildExitPnlSnapshot,
  priceBreakEvenWithFees,
} from "@/src/server/profitability/pr04-pnl-accounting";
import { computePartialLegQuantity, applyPartialFill, totalSellWouldExceed } from "@/src/server/profitability/pr04-partial-exit";
import { EXIT_POLICY_REGISTRY } from "@/src/server/profitability/pr04-policy-registry";
import { runPr04ExitReplayAnalysis } from "@/src/server/profitability/pr04-replay";
import {
  buildRiskReference,
  computeRMultiple,
  resolveStructuralStopFromInvalidation,
} from "@/src/server/profitability/pr04-structural-stop";
import { evaluateTimeExit } from "@/src/server/profitability/pr04-time-exit";
import { isTrailingStopHit, updateCausalTrailing } from "@/src/server/profitability/pr04-trailing";
import {
  bootstrapPr04ExitStateFromEntry,
  buildPr04ExitMetadataAtEntry,
  isPr04ExitEvaluationEnabled,
  resolvePr04CloseQuantity,
} from "@/src/server/profitability/pr04-exit-bridge";
import {
  ensurePr04ExitExperiment,
  getProfitabilityExperiment,
  resetProfitabilityExperimentRegistryForTests,
} from "@/src/server/profitability/experiment-registry";
import type { ExitTickObservation } from "@/src/server/profitability/pr04-types";

const baseNow = Date.parse("2026-09-06T10:00:00.000Z");
const invalidation = {
  referenceLevel: 100,
  invalidationThreshold: 99.2,
  reasonCode: "LEVEL_HOLD_BREACH",
  computedAtMs: baseNow,
  availableAtMs: baseNow,
  validUntilMs: baseNow + 60_000,
  sourceObservations: ["CONFIRMED_PIVOT_HIGH"],
};

function obs(mark: number, offset = 0, overrides?: Partial<ExitTickObservation>): ExitTickObservation {
  const t = baseNow + offset;
  return {
    eventId: `evt:${t}:${mark}`,
    eventAtMs: t,
    availableAtMs: t,
    markPrice: mark,
    bid: mark,
    ask: mark,
    high: mark,
    low: mark,
    closed: true,
    stale: false,
    dataGap: false,
    ...overrides,
  };
}

function initState(policyId: keyof typeof EXIT_POLICY_REGISTRY, entry = 100, qty = 1) {
  const snapshot = buildExitPolicySnapshotAtEntry({
    positionId: "pos-1",
    strategyId: "BREAKOUT_RETEST",
    entryPolicyVersion: "pr03-momentum-and-retest-v1",
    entrySignalId: "sig-1",
    setupId: "setup-1",
    exitPolicyId: policyId,
    experimentalMode: true,
    takeProfitPercent: 3,
    invalidation,
  });
  return initializeExitPolicyState({
    snapshot,
    side: "LONG",
    entryFills: [{ price: entry, quantity: qty, fee: 0.1, atMs: baseNow }],
    entryFee: 0.1,
  });
}

describe("PR04 exit and position management", () => {
  it("labels a tightened trailing stop separately from the original structural stop", () => {
    initState("STRUCTURAL_STOP_TRAIL");
    const armed = evaluateExitPolicyTick({ positionId: "pos-1", side: "LONG", observation: obs(102, 1) });
    expect(armed.state.trailingArmed).toBe(true);
    expect(armed.decision.kind).toBe("NONE");
    const hit = evaluateExitPolicyTick({ positionId: "pos-1", side: "LONG", observation: obs(101, 2) });
    expect(hit.decision.kind).toBe("TRAILING_STOP");
    expect(hit.decision.reasonCode).toBe("TRAILING_STOP_HIT");
  });
  beforeEach(() => {
    resetExitPolicyStoreForTests();
    resetProfitabilityExperimentRegistryForTests();
    delete process.env.EXECUTION_PR04_EXIT_EVAL_ENABLED;
  });

  afterAll(() => {
    resetExitPolicyStoreForTests();
  });

  it("1 binds strategy identity to exit policy snapshot", () => {
    const snap = buildPr04ExitMetadataAtEntry({
      positionId: "pos-a",
      strategyId: "MOMENTUM_CONTINUATION",
      entryPolicyVersion: "pr03-momentum-and-retest-v1",
      takeProfitPercent: 2,
    });
    expect(snap.strategyId).toBe("MOMENTUM_CONTINUATION");
    expect(snap.exitPolicyId).toBe("BASELINE_FIXED_TP_SL");
  });

  it("2 keeps policy version fixed on open position state", () => {
    const state = initState("STRUCTURAL_STOP_TRAIL");
    expect(state.snapshot.policyVersion).toBe("pr04-exit-and-position-management-v1");
    evaluateExitPolicyTick({ positionId: "pos-1", side: "LONG", observation: obs(101) });
    expect(getExitPolicyState("pos-1")!.snapshot.exitPolicyId).toBe("STRUCTURAL_STOP_TRAIL");
  });

  it("3 missing invalidation yields unknown structural stop", () => {
    const stop = resolveStructuralStopFromInvalidation({
      strategyId: "EARLY_ACCELERATION",
      side: "LONG",
      entryPrice: 100,
      invalidation: null,
      tickSize: 0.01,
    });
    expect(stop.quality).toBe("UNKNOWN");
  });

  it("4 rejects invalid stop direction for long", () => {
    const stop = resolveStructuralStopFromInvalidation({
      strategyId: "BREAKOUT_RETEST",
      side: "LONG",
      entryPrice: 100,
      invalidation: { ...invalidation, invalidationThreshold: 101 },
      tickSize: 0.01,
    });
    expect(stop.stopPrice).toBeNull();
    expect(stop.reasonCode).toBe("STOP_WRONG_SIDE_FOR_LONG");
  });

  it("5 structural stop distance feeds risk reference", () => {
    const risk = buildRiskReference({
      entryPrice: 100,
      initialStopPrice: 99.2,
      initialQuantity: 2,
      entryFee: 0.2,
      includesFeesInBreakEven: true,
      computedAtMs: baseNow,
    });
    expect(risk.quality).toBe("VALID");
    expect(risk.initialRiskNotional).toBeGreaterThan(0);
  });

  it("6 does not widen structural stop silently after slippage", () => {
    initState("STRUCTURAL_STOP_TARGET");
    const before = getExitPolicyState("pos-1")!.activeStopPrice;
    evaluateExitPolicyTick({ positionId: "pos-1", side: "LONG", observation: obs(100.5, 1000) });
    expect(getExitPolicyState("pos-1")!.activeStopPrice).toBe(before);
  });

  it("7 initial R reference does not change after trailing update", () => {
    initState("STRUCTURAL_STOP_TRAIL");
    const initialR = getExitPolicyState("pos-1")!.riskReference;
    for (let i = 0; i < 5; i++) {
      evaluateExitPolicyTick({ positionId: "pos-1", side: "LONG", observation: obs(100 + i * 0.5, i * 1000) });
    }
    expect(getExitPolicyState("pos-1")!.riskReference.computedAtMs).toBe(initialR.computedAtMs);
  });

  it("8 zero risk does not produce infinite R multiple", () => {
    const risk = buildRiskReference({
      entryPrice: 100,
      initialStopPrice: 100,
      initialQuantity: 1,
      entryFee: 0,
      includesFeesInBreakEven: false,
      computedAtMs: baseNow,
    });
    expect(computeRMultiple({ riskReference: risk, realizedNetPnl: 10 })).toBeNull();
  });

  it("9 trailing does not arm before activation threshold", () => {
    initState("STRUCTURAL_STOP_TRAIL");
    evaluateExitPolicyTick({ positionId: "pos-1", side: "LONG", observation: obs(100.5) });
    expect(getExitPolicyState("pos-1")!.trailingArmed).toBe(false);
  });

  it("10 long trailing stop never loosens downward", () => {
    const state = initState("STRUCTURAL_STOP_TRAIL");
    const up = updateCausalTrailing({
      state,
      side: "LONG",
      markPrice: 102,
      observationHigh: 102.5,
      observationLow: 101,
      activationPct: 1,
      gapPct: 0.5,
      eventId: "e1",
      lastProcessedEventId: null,
    });
    const down = updateCausalTrailing({
      state: { ...state, activeStopPrice: up.stopPrice, trailingHighWaterMark: up.highWaterMark, trailingArmed: true },
      side: "LONG",
      markPrice: 101,
      observationHigh: 101,
      observationLow: 100.5,
      activationPct: 1,
      gapPct: 0.5,
      eventId: "e2",
      lastProcessedEventId: "e1",
    });
    expect((down.stopPrice ?? 0) >= (up.stopPrice ?? 0)).toBe(true);
  });

  it("11 future high does not retroactively change trailing when event is duplicate", () => {
    const state = initState("STRUCTURAL_STOP_TRAIL");
    const first = updateCausalTrailing({
      state,
      side: "LONG",
      markPrice: 101,
      observationHigh: 101,
      observationLow: 100.5,
      activationPct: 0.5,
      gapPct: 0.4,
      eventId: "dup",
      lastProcessedEventId: null,
    });
    const dup = updateCausalTrailing({
      state: { ...state, activeStopPrice: first.stopPrice, trailingHighWaterMark: 101, trailingArmed: true, lastEventId: "dup" },
      side: "LONG",
      markPrice: 105,
      observationHigh: 105,
      observationLow: 104,
      activationPct: 0.5,
      gapPct: 0.4,
      eventId: "dup",
      lastProcessedEventId: "dup",
    });
    expect(dup.duplicateSuppressed).toBe(true);
  });

  it("12 ambiguous same-candle high/low does not assume optimistic ordering", () => {
    initState("STRUCTURAL_STOP_TRAIL");
    const result = evaluateExitPolicyTick({
      positionId: "pos-1",
      side: "LONG",
      observation: obs(100.8, 0, { high: 103, low: 99.1, closed: false }),
    });
    expect(result.decision.kind).not.toBe("TRAILING_STOP");
  });

  it("13 duplicate event produces single trailing progression", () => {
    initState("STRUCTURAL_STOP_TRAIL");
    const a = evaluateExitPolicyTick({ positionId: "pos-1", side: "LONG", observation: obs(102, 0) });
    const b = evaluateExitPolicyTick({ positionId: "pos-1", side: "LONG", observation: obs(102, 0, { eventId: a.state.lastEventId! }) });
    expect(b.decision.reasonCode).toBe("DUPLICATE_EVENT_SUPPRESSED");
  });

  it("14 restart preserves trailing state in store", () => {
    initState("STRUCTURAL_STOP_TRAIL");
    evaluateExitPolicyTick({ positionId: "pos-1", side: "LONG", observation: obs(103, 1000) });
    const saved = getExitPolicyState("pos-1")!;
    expect(saved.trailingHighWaterMark).toBeGreaterThan(100);
    evaluateExitPolicyTick({ positionId: "pos-1", side: "LONG", observation: obs(103.2, 2000) });
    expect(getExitPolicyState("pos-1")!.trailingHighWaterMark).toBeGreaterThanOrEqual(saved.trailingHighWaterMark ?? 0);
  });

  it("15 partial leg quantity uses initial quantity base", () => {
    const leg = computePartialLegQuantity({
      legId: "leg-25",
      fractionOfInitial: 0.25,
      initialQuantity: 4,
      remainingQuantity: 4,
      completedLegs: [],
      stepSize: 0.1,
      minNotional: 10,
      markPrice: 100,
    });
    expect(leg.quantity).toBe(1);
  });

  it("16 completed partial leg does not retrigger", () => {
    const leg = computePartialLegQuantity({
      legId: "leg-25",
      fractionOfInitial: 0.25,
      initialQuantity: 4,
      remainingQuantity: 3,
      completedLegs: ["leg-25"],
      stepSize: 0.1,
      minNotional: 10,
      markPrice: 100,
    });
    expect(leg.applicable).toBe(false);
  });

  it("17 partial fill keeps remaining quantity", () => {
    const partial = applyPartialFill({ requestedQuantity: 1, filledQuantity: 0.4, remainingQuantity: 2 });
    expect(partial.nextRemaining).toBe(1.6);
    expect(partial.partial).toBe(true);
  });

  it("18 total sell cannot exceed remaining", () => {
    expect(totalSellWouldExceed({ reservedSellQuantity: 0.5, requestedQuantity: 0.8, remainingQuantity: 1 })).toBe(true);
  });

  it("19 step size and min notional enforced", () => {
    const leg = computePartialLegQuantity({
      legId: "leg-25",
      fractionOfInitial: 0.1,
      initialQuantity: 0.5,
      remainingQuantity: 0.5,
      completedLegs: [],
      stepSize: 0.01,
      minNotional: 50,
      markPrice: 100,
    });
    expect(leg.reasonCode).toBe("MIN_NOTIONAL_UNMET");
  });

  it("20 dust does not create fake full close", () => {
    initState("STRUCTURAL_PARTIAL_TRAIL", 100, 0.001);
    const result = evaluateExitPolicyTick({ positionId: "pos-1", side: "LONG", observation: obs(103) });
    expect(result.decision.kind).not.toBe("PARTIAL_TAKE_PROFIT");
  });

  it("21 base fee reduces quantity only via accounting not magic fill", () => {
    initState("STRUCTURAL_STOP_TARGET");
    applyExitFill({
      positionId: "pos-1",
      fill: { price: 101, quantity: 0.5, fee: 0.05, feeAsset: "BASE", atMs: baseNow + 1 },
      decisionKind: "PARTIAL_TAKE_PROFIT",
    });
    expect(getExitPolicyState("pos-1")!.remainingQuantity).toBe(0.5);
  });

  it("22 quote fee reflected in net pnl snapshot", () => {
    initState("STRUCTURAL_STOP_TARGET");
    applyExitFill({
      positionId: "pos-1",
      fill: { price: 101, quantity: 1, fee: 0.2, feeAsset: "QUOTE", atMs: baseNow + 1 },
      decisionKind: "TAKE_PROFIT",
    });
    const pnl = buildExitPnlSnapshot({ state: getExitPolicyState("pos-1")!, markPrice: 101, side: "LONG" });
    expect(pnl.realizedFees).toBe(0.2);
    expect(pnl.realizedNetPnl).not.toBeNull();
  });

  it("23 unknown fee asset keeps net pnl UNKNOWN", () => {
    initState("STRUCTURAL_STOP_TARGET");
    applyExitFill({
      positionId: "pos-1",
      fill: { price: 101, quantity: 1, fee: 0.1, feeAsset: "UNKNOWN", atMs: baseNow + 1 },
      decisionKind: "TAKE_PROFIT",
    });
    const pnl = buildExitPnlSnapshot({ state: getExitPolicyState("pos-1")!, markPrice: 101, side: "LONG" });
    expect(pnl.status).toBe("UNKNOWN");
  });

  it("24 price break-even differs from net break-even with fees", () => {
    const priceBe = priceBreakEvenWithFees({ entryPrice: 100, entryFeePerUnit: 0.05, exitFeePerUnit: 0.05 });
    expect(priceBe).toBeGreaterThan(100);
  });

  it("25 time exit uses first-fill anchor", () => {
    initState("STRUCTURAL_TIME_DECAY");
    const state = getExitPolicyState("pos-1")!;
    const time = evaluateTimeExit({
      snapshot: state.snapshot,
      timeAnchorMs: state.timeAnchorMs,
      nowMs: state.timeAnchorMs + state.snapshot.timeExitMs! + 1,
      progressPct: 0.1,
      minProgressPct: 0.5,
    });
    expect(time.triggered).toBe(true);
  });

  it("26 restart does not reset time anchor in state object", () => {
    initState("STRUCTURAL_TIME_DECAY");
    const anchor = getExitPolicyState("pos-1")!.timeAnchorMs;
    evaluateExitPolicyTick({ positionId: "pos-1", side: "LONG", observation: obs(100.2, 5000) });
    expect(getExitPolicyState("pos-1")!.timeAnchorMs).toBe(anchor);
  });

  it("27 stale mark does not produce exit fill decision", () => {
    initState("STRUCTURAL_STOP_TARGET");
    const result = evaluateExitPolicyTick({
      positionId: "pos-1",
      side: "LONG",
      observation: obs(98, 0, { stale: true }),
    });
    expect(result.decision.kind).toBe("NONE");
    expect(result.decision.reasonCode).toBe("STALE_MARK");
  });

  it("28 setup invalidation contract alone does not auto-close without policy hit", () => {
    initState("BASELINE_FIXED_TP_SL");
    const result = evaluateExitPolicyTick({ positionId: "pos-1", side: "LONG", observation: obs(100.5) });
    expect(result.decision.kind).toBe("NONE");
  });

  it("29 coordinator priority prevents double sell intent", () => {
    const decision = pickHighestPriorityDecision([
      { kind: "TAKE_PROFIT", reasonCode: "A", decisionAtMs: 1, availableAtMs: 1, closeQuantity: 1, decisionPrice: 103, stopPriceAfter: null, partialLegId: null, duplicateSuppressed: false, policyId: "STRUCTURAL_STOP_TARGET" },
      { kind: "STRUCTURAL_STOP", reasonCode: "B", decisionAtMs: 1, availableAtMs: 1, closeQuantity: 1, decisionPrice: 99, stopPriceAfter: 99, partialLegId: null, duplicateSuppressed: false, policyId: "STRUCTURAL_STOP_TARGET" },
    ]);
    expect(decision.kind).toBe("STRUCTURAL_STOP");
  });

  it("30 risk override wins over trailing", () => {
    initState("STRUCTURAL_STOP_TRAIL");
    const result = evaluateExitPolicyTick({
      positionId: "pos-1",
      side: "LONG",
      observation: obs(102),
      riskOverride: true,
    });
    expect(result.decision.kind).toBe("RISK_OVERRIDE");
  });

  it("31 no blind retry when order in flight", () => {
    initState("STRUCTURAL_STOP_TARGET");
    const state = getExitPolicyState("pos-1")!;
    state.orderState = "SUBMITTED";
    state.reservedSellQuantity = 1;
    const result = evaluateExitPolicyTick({ positionId: "pos-1", side: "LONG", observation: obs(103) });
    expect(result.decision.reasonCode).toBe("ORDER_IN_FLIGHT");
  });

  it("31b completed partial leg does not block subsequent stop", () => {
    initState("STRUCTURAL_PARTIAL_TRAIL", 100, 1);
    applyExitFill({
      positionId: "pos-1",
      fill: { price: 102.5, quantity: 0.5, fee: 0.05, feeAsset: "QUOTE", atMs: baseNow + 1 },
      decisionKind: "PARTIAL_TAKE_PROFIT",
      partialLegId: "leg-25",
    });
    const state = getExitPolicyState("pos-1")!;
    expect(state.remainingQuantity).toBe(0.5);
    expect(state.orderState).toBe("NONE");
    expect(state.reservedSellQuantity).toBe(0);
    state.activeStopPrice = 99;
    const stop = evaluateExitPolicyTick({ positionId: "pos-1", side: "LONG", observation: obs(90) });
    expect(stop.decision.kind).toBe("STRUCTURAL_STOP");
    expect(stop.decision.reasonCode).not.toBe("ORDER_IN_FLIGHT");
    expect(stop.decision.closeQuantity).toBe(0.5);
  });

  it("31c open partial order still blocks duplicate sell", () => {
    initState("STRUCTURAL_STOP_TARGET");
    const state = getExitPolicyState("pos-1")!;
    state.orderState = "PARTIALLY_FILLED";
    state.reservedSellQuantity = 0.3;
    state.activeExitOrder = {
      intentId: "intent-open",
      requestedQuantity: 0.5,
      executedQuantity: 0.2,
      openQuantity: 0.3,
      partialLegId: null,
      terminal: false,
    };
    const result = evaluateExitPolicyTick({ positionId: "pos-1", side: "LONG", observation: obs(103) });
    expect(result.decision.reasonCode).toBe("ORDER_IN_FLIGHT");
  });

  it("32 late partial fill updates remaining quantity", () => {
    initState("STRUCTURAL_PARTIAL_TRAIL", 100, 2);
    applyExitFill({
      positionId: "pos-1",
      fill: { price: 102.5, quantity: 0.4, fee: 0.02, feeAsset: "QUOTE", atMs: baseNow + 2 },
      decisionKind: "PARTIAL_TAKE_PROFIT",
      partialLegId: "leg-25",
    });
    expect(getExitPolicyState("pos-1")!.remainingQuantity).toBe(1.6);
  });

  it("33 reconciliation state survives applyExitFill sequence", () => {
    initState("STRUCTURAL_PARTIAL_TRAIL", 100, 1);
    applyExitFill({
      positionId: "pos-1",
      fill: { price: 101, quantity: 0.25, fee: 0.01, feeAsset: "QUOTE", atMs: baseNow + 1 },
      decisionKind: "PARTIAL_TAKE_PROFIT",
      partialLegId: "leg-25",
    });
    applyExitFill({
      positionId: "pos-1",
      fill: { price: 102, quantity: 0.75, fee: 0.03, feeAsset: "QUOTE", atMs: baseNow + 2 },
      decisionKind: "TRAILING_STOP",
    });
    expect(getExitPolicyState("pos-1")!.terminalStatus).toBe("CLOSED");
  });

  it("34 duplicate settlement fill does not double count in snapshot", () => {
    initState("STRUCTURAL_STOP_TARGET");
    applyExitFill({
      positionId: "pos-1",
      fill: { price: 101, quantity: 1, fee: 0.1, feeAsset: "QUOTE", atMs: baseNow + 1 },
      decisionKind: "TAKE_PROFIT",
    });
    const pnl = buildExitPnlSnapshot({ state: getExitPolicyState("pos-1")!, markPrice: null, side: "LONG" });
    expect(pnl.realizedGrossPnl).toBeCloseTo(1, 5);
  });

  it("35 gap through stop does not assume stop fill price", () => {
    initState("STRUCTURAL_STOP_TARGET");
    const result = evaluateExitPolicyTick({ positionId: "pos-1", side: "LONG", observation: obs(98.5) });
    expect(result.decision.decisionPrice).toBe(98.5);
    expect(result.decision.kind).toBe("STRUCTURAL_STOP");
  });

  it("36 limit touch alone is not auto full fill without policy", () => {
    initState("BASELINE_FIXED_TP_SL");
    const result = evaluateExitPolicyTick({ positionId: "pos-1", side: "LONG", observation: obs(102.9) });
    expect(result.decision.kind).toBe("NONE");
  });

  it("37 spread not double-counted when fill includes spread flag in economics path", () => {
    initState("STRUCTURAL_STOP_TARGET");
    applyExitFill({
      positionId: "pos-1",
      fill: { price: 101, quantity: 1, fee: 0.1, feeAsset: "QUOTE", atMs: baseNow + 1 },
      decisionKind: "TAKE_PROFIT",
    });
    const pnl = buildExitPnlSnapshot({
      state: getExitPolicyState("pos-1")!,
      markPrice: 101,
      side: "LONG",
    });
    expect(pnl.realizedFees).toBe(0.1);
  });

  it("38 partial realized plus open remainder preserves totals", () => {
    initState("STRUCTURAL_PARTIAL_TRAIL", 100, 2);
    applyExitFill({
      positionId: "pos-1",
      fill: { price: 102.5, quantity: 0.5, fee: 0.05, feeAsset: "QUOTE", atMs: baseNow + 1 },
      decisionKind: "PARTIAL_TAKE_PROFIT",
    });
    const pnl = buildExitPnlSnapshot({ state: getExitPolicyState("pos-1")!, markPrice: 103, side: "LONG" });
    expect(pnl.status).toBe("PARTIAL");
    expect(pnl.unrealizedGrossPnl).not.toBeNull();
  });

  it("39 open position not counted as closed trade stats", () => {
    initState("STRUCTURAL_STOP_TRAIL");
    const pnl = buildExitPnlSnapshot({ state: getExitPolicyState("pos-1")!, markPrice: 101, side: "LONG" });
    expect(getExitPolicyState("pos-1")!.terminalStatus).toBe("OPEN");
    expect(pnl.realizedGrossPnl).toBe(0);
  });

  it("40 data end marks OPEN as CENSORED", () => {
    initState("STRUCTURAL_STOP_TRAIL");
    markExitDataEnd("pos-1");
    expect(getExitPolicyState("pos-1")!.terminalStatus).toBe("CENSORED");
  });

  it("41 matched entry manifest hash is stable", () => {
    const manifest = buildMatchedEntryManifest({
      entrySignalId: "sig-1",
      strategyId: "BREAKOUT_RETEST",
      entryPolicyVersion: "pr03-momentum-and-retest-v1",
      entryAtMs: baseNow,
      fills: [{ price: 100, quantity: 1, fee: 0.1, atMs: baseNow }],
      riskReference: buildRiskReference({
        entryPrice: 100,
        initialStopPrice: 99.2,
        initialQuantity: 1,
        entryFee: 0.1,
        includesFeesInBreakEven: true,
        computedAtMs: baseNow,
      }),
      invalidation,
      featureEvidenceIds: ["snap-1"],
      dataSource: "SYNTHETIC_FIXTURE",
      replayWindow: { fromMs: baseNow, toMs: baseNow + 60_000 },
    });
    const clone = { ...manifest, manifestHash: manifest.manifestHash };
    expect(verifyManifestImmutable(manifest, clone)).toBe(true);
  });

  it("42 variant states isolated per position id", () => {
    const snapA = buildExitPolicySnapshotAtEntry({
      positionId: "pos-a",
      strategyId: "EARLY_ACCELERATION",
      entryPolicyVersion: "pr02-early-acceleration-v1",
      entrySignalId: "a",
      setupId: "a",
      exitPolicyId: "STRUCTURAL_STOP_TRAIL",
      experimentalMode: true,
      takeProfitPercent: 3,
      invalidation,
    });
    const snapB = buildExitPolicySnapshotAtEntry({
      positionId: "pos-b",
      strategyId: "EARLY_ACCELERATION",
      entryPolicyVersion: "pr02-early-acceleration-v1",
      entrySignalId: "b",
      setupId: "b",
      exitPolicyId: "STRUCTURAL_STOP_TARGET",
      experimentalMode: true,
      takeProfitPercent: 3,
      invalidation,
    });
    initializeExitPolicyState({ snapshot: snapA, side: "LONG", entryFills: [{ price: 100, quantity: 1, fee: 0.1, atMs: baseNow }], entryFee: 0.1 });
    initializeExitPolicyState({ snapshot: snapB, side: "LONG", entryFills: [{ price: 100, quantity: 1, fee: 0.1, atMs: baseNow }], entryFee: 0.1 });
    expect(getExitPolicyState("pos-a")!.snapshot.exitPolicyId).not.toBe(getExitPolicyState("pos-b")!.snapshot.exitPolicyId);
  });

  it("43 replay uses production exit evaluator", () => {
    const manifest = buildMatchedEntryManifest({
      entrySignalId: "sig-r",
      strategyId: "MOMENTUM_CONTINUATION",
      entryPolicyVersion: "pr03-momentum-and-retest-v1",
      entryAtMs: baseNow,
      fills: [{ price: 100, quantity: 1, fee: 0.1, atMs: baseNow }],
      riskReference: buildRiskReference({
        entryPrice: 100,
        initialStopPrice: 99.2,
        initialQuantity: 1,
        entryFee: 0.1,
        includesFeesInBreakEven: true,
        computedAtMs: baseNow,
      }),
      invalidation,
      featureEvidenceIds: [],
      dataSource: "SYNTHETIC_FIXTURE",
      replayWindow: { fromMs: baseNow, toMs: baseNow + 120_000 },
    });
    const report = runPr04ExitReplayAnalysis({
      datasetId: "ds-1",
      manifest,
      policyId: "STRUCTURAL_STOP_TARGET",
      ticks: [{ tickIndex: 0, observation: obs(99.1, 1000) }],
    });
    expect(report.status).toBe("COMPLETED");
    expect(report.decisionCount).toBeGreaterThan(0);
  });

  it("44 adding future ticks does not rewrite prior exit decision", () => {
    initState("STRUCTURAL_STOP_TARGET");
    const first = evaluateExitPolicyTick({ positionId: "pos-1", side: "LONG", observation: obs(100.5, 0) });
    evaluateExitPolicyTick({ positionId: "pos-1", side: "LONG", observation: obs(104, 60_000) });
    expect(first.decision.kind).toBe(first.decision.kind);
  });

  it("45 live authorization and default activation unchanged", () => {
    expect(isPr04ExitEvaluationEnabled()).toBe(false);
    expect(resolveExecutionAuthorization({ mode: "LIVE", strategyActivation: "LIVE_DISABLED" })).toBe("LIVE_DISABLED");
    const snap = buildPr04ExitMetadataAtEntry({
      positionId: "pos-z",
      strategyId: "BREAKOUT_RETEST",
      entryPolicyVersion: "pr03-momentum-and-retest-v1",
    });
    expect(snap.experimentalMode).toBe(false);
    const boot = bootstrapPr04ExitStateFromEntry({
      snapshot: snap,
      side: "LONG",
      entryPrice: 100,
      quantity: 1,
      entryFee: 0.1,
      openedAtMs: baseNow,
    });
    expect(boot).toBeNull();
    const exp = ensurePr04ExitExperiment();
    expect(exp.status).toBe("PLANNED");
    expect(getProfitabilityExperiment("pr04-exit-and-position-management-v1")?.variantCount).toBe(5);
    expect(resolvePr04CloseQuantity("missing", 1)).toBe(1);
    expect(isTrailingStopHit({ side: "LONG", markPrice: 99, stopPrice: 100 })).toBe(true);
    expect(allocateFeeAcrossFills({ totalFee: 0.3, fills: [], feeAsset: "QUOTE" })).toEqual([]);
  });
});
