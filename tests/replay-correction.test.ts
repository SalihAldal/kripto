import { describe, expect, it, beforeEach } from "vitest";
import {
  filterTradesAtDecision,
  klinesToCausalCandles,
  tradeAvailableAtMs,
  tradeEventAtMs,
} from "@/src/server/execution/fix01-strategy-context-builder";
import { MarketStateStore } from "@/src/server/market-data/spine/market-state-store";
import type { MarketCandleEvent, MarketTradeEvent } from "@/src/server/market-data/spine/events";
import { resetExitPolicyStoreForTests } from "@/src/server/profitability/pr04-exit-evaluator";
import { buildMatchedEntryManifest } from "@/src/server/profitability/pr04-matched-entry-manifest";
import {
  runPr04ExitReplayWithOutcome,
  stepPr04ExitReplayTick,
  createPr04ExitReplaySession,
} from "@/src/server/profitability/pr04-replay";
import { buildRiskReference } from "@/src/server/profitability/pr04-structural-stop";
import type { ExitTickObservation } from "@/src/server/profitability/pr04-types";
import {
  buildCounterfactualEntryShift,
  runCausalEntryShiftNegativeControl,
} from "@/src/server/profitability/pr05-negative-control";
import { runPortfolioReplay } from "@/src/server/profitability/pr05-portfolio-replay";
import { findMarketQuoteAtMs } from "@/src/server/profitability/pr05-replay-clock";

const baseNow = Date.parse("2026-09-06T10:00:00.000Z");

function obs(mark: number, offset = 0): ExitTickObservation {
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
  };
}

const invalidation = {
  referenceLevel: 100,
  invalidationThreshold: 99.2,
  reasonCode: "LEVEL_HOLD_BREACH",
  computedAtMs: baseNow,
  availableAtMs: baseNow,
  validUntilMs: baseNow + 60_000,
  sourceObservations: ["CONFIRMED_PIVOT_HIGH"],
};

function manifest(id: string, entryAtMs = baseNow, entryPrice = 100) {
  return buildMatchedEntryManifest({
    entrySignalId: id,
    strategyId: "MOMENTUM_CONTINUATION",
    entryPolicyVersion: "pr03-v1",
    entryAtMs,
    fills: [{ price: entryPrice, quantity: 1, fee: 0.1, atMs: entryAtMs }],
    riskReference: buildRiskReference({
      entryPrice,
      initialStopPrice: entryPrice * 0.992,
      initialQuantity: 1,
      entryFee: 0.1,
      includesFeesInBreakEven: true,
      computedAtMs: entryAtMs,
    }),
    invalidation,
    featureEvidenceIds: [],
    dataSource: "SYNTHETIC_FIXTURE",
    replayWindow: { fromMs: entryAtMs, toMs: entryAtMs + 120_000 },
  });
}

beforeEach(() => resetExitPolicyStoreForTests());

describe("REPLAY correction — availability causality", () => {
  it("1 excludes trade with eventAt in past but receiveTime in future", () => {
    const trade: MarketTradeEvent = {
      type: "trade",
      symbol: "BTCTRY",
      price: 100,
      quantity: 1,
      quoteNotional: 100,
      eventTime: baseNow - 5_000,
      tradeTime: baseNow - 5_000,
      receiveTime: baseNow + 5_000,
      buyerMaker: false,
      takerSide: "BUY",
      source: "memory",
    };
    expect(tradeEventAtMs(trade)).toBe(baseNow - 5_000);
    expect(tradeAvailableAtMs(trade)).toBe(baseNow + 5_000);
    expect(filterTradesAtDecision([trade], baseNow)).toHaveLength(0);
  });

  it("3 REST backfill candle is not available at closeTime", () => {
    const store = new MarketStateStore();
    const closeTime = baseNow - 60_000;
    const receivedAt = baseNow;
    store.applyCandle({
      type: "candle",
      symbol: "BTCTRY",
      interval: "1m",
      openTime: closeTime - 60_000,
      closeTime,
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
      volume: 10,
      quoteVolume: 1000,
      closed: true,
      eventTime: closeTime,
      receiveTime: receivedAt,
      source: "binance-rest-bootstrap",
    });
    const deep = store.getDeepState("BTCTRY", baseNow)!;
    const atClose = klinesToCausalCandles(deep.klines1m, closeTime);
    expect(atClose).toHaveLength(0);
    const atReceive = klinesToCausalCandles(deep.klines1m, receivedAt);
    expect(atReceive).toHaveLength(1);
    expect(atReceive[0]?.availableAt).toBe(receivedAt);
  });
});

describe("REPLAY correction — fill path", () => {
  it("9 rejects orphan applyFill without open order", () => {
    const m = manifest("orphan-fill");
    const session = createPr04ExitReplaySession({ manifest: m, policyId: "STRUCTURAL_STOP_TARGET" });
    const step = stepPr04ExitReplayTick(session, {
      tickIndex: 0,
      observation: obs(100, 0),
      applyFill: { price: 100, quantity: 1, fee: 0.1, feeAsset: "QUOTE" },
    });
    expect(step.fillApplied).toBe(false);
    expect(step.fillRejectedReason).toBe("FILL_WITHOUT_OPEN_ORDER");
  });

  it("10 allows late fill on NONE tick when open order exists", () => {
    const m = manifest("late-fill");
    const session = createPr04ExitReplaySession({ manifest: m, policyId: "STRUCTURAL_PARTIAL_TRAIL" });
    stepPr04ExitReplayTick(session, { tickIndex: 0, observation: obs(103, 0) });
    const late = stepPr04ExitReplayTick(session, {
      tickIndex: 1,
      observation: obs(103, 1000),
      applyFill: { price: 103, quantity: 0.25, fee: 0.02, feeAsset: "QUOTE" },
    });
    expect(late.fillApplied).toBe(true);
  });
});

describe("REPLAY correction — negative control", () => {
  it("13 preserves market tick timestamps while shifting entry", () => {
    const m = manifest("nc-ts", baseNow);
    const ticks = [
      { tickIndex: 0, observation: obs(100, 0) },
      { tickIndex: 1, observation: obs(99, 10_000) },
      { tickIndex: 2, observation: obs(98, 20_000), applyFill: { price: 98, quantity: 1, fee: 0.05, feeAsset: "QUOTE" as const } },
    ];
    const originalEventAt = ticks[1]!.observation.eventAtMs;
    const built = buildCounterfactualEntryShift({ manifest: m, marketTicks: ticks, shiftMs: 5_000 });
    expect(built.status).toBe("OK");
    if (built.status === "OK") {
      expect(built.exitTicks[0]!.observation.eventAtMs).toBe(originalEventAt);
      expect(built.manifest.entryAtMs).toBe(baseNow + 5_000);
      expect(built.manifest.fills[0]!.atMs).toBe(baseNow + 5_000);
      expect(built.marketTicksUnchanged).toBe(true);
    }
  });

  it("17 same seed yields deterministic control", () => {
    const m = manifest("nc-seed");
    const ticks = {
      [m.manifestId]: [{ tickIndex: 0, observation: obs(98, 5000), applyFill: { price: 98, quantity: 1, fee: 0.05, feeAsset: "QUOTE" as const } }],
    };
    const args = {
      datasetId: "ds",
      manifests: [m],
      ticksByManifestId: ticks,
      policyIds: ["STRUCTURAL_STOP_TARGET"] as const,
      seed: 42,
      iterations: 3,
    };
    const a = runCausalEntryShiftNegativeControl(args);
    const b = runCausalEntryShiftNegativeControl(args);
    expect(a.controlNetExpectancies).toEqual(b.controlNetExpectancies);
    expect(a.marketTimestampsPreserved).toBe(true);
  });

  it("18 counterfactual does not carry old applyFill payloads", () => {
    const m = manifest("nc-no-fill-copy", baseNow);
    const ticks = [
      { tickIndex: 0, observation: obs(100, 0) },
      { tickIndex: 1, observation: obs(110, 10_000), applyFill: { price: 99, quantity: 1, fee: 0.1, feeAsset: "QUOTE" as const } },
    ];
    const built = buildCounterfactualEntryShift({ manifest: m, marketTicks: ticks, shiftMs: 5_000 });
    expect(built.status).toBe("OK");
    if (built.status === "OK") {
      const originalFilledPrices = ticks
        .filter((tick) => tick.applyFill)
        .map((tick) => tick.applyFill!.price);
      const shiftedFill = built.exitTicks.find((tick) => "applyFill" in tick);
      expect(shiftedFill).toBeTruthy();
      if (shiftedFill && "applyFill" in shiftedFill) {
        expect(originalFilledPrices.includes(shiftedFill.applyFill!.price)).toBe(false);
      }
    }
  });
});

describe("REPLAY correction — portfolio capital", () => {
  it("23 B cannot use A future close capital when max positions is 1", () => {
    const entryA = baseNow;
    const entryB = baseNow + 60_000;
    const closeA = baseNow + 3_600_000;
    const mA = manifest("life-a", entryA, 100);
    const mB = manifest("life-b", entryB, 100);
    const ticksA = [
      {
        tickIndex: 0,
        observation: obs(98, closeA - entryA),
        applyFill: { price: 98, quantity: 1, fee: 0.05, feeAsset: "QUOTE" as const },
      },
    ];
    const ticksB = [{ tickIndex: 0, observation: obs(101, 0) }];
    const result = runPortfolioReplay({
      datasetId: "ds",
      lifecycleRows: [
        { lifecycleId: "life-a", eventAtMs: entryA, labelEndAtMs: closeA, manifest: mA },
        { lifecycleId: "life-b", eventAtMs: entryB, labelEndAtMs: entryB + 60_000, manifest: mB },
      ],
      policyId: "STRUCTURAL_STOP_TARGET",
      ticksByManifestId: { [mA.manifestId]: ticksA, [mB.manifestId]: ticksB },
      startingCapital: 110,
      maxConcurrentPositions: 1,
    });
    expect(result.acceptedLifecycles).toBe(1);
    expect(result.rejectedForPositionLimit).toBe(1);
    expect(result.rejections.some((r) => r.lifecycleId === "life-b" && r.reasonCode === "POSITION_LIMIT")).toBe(true);
    expect(result.endingCapital).toBeGreaterThan(105);
  });

  it("24 100 sermaye, acik 1 BTC mark 100 ise equity 100 olur", () => {
    const m = buildMatchedEntryManifest({
      entrySignalId: "eq-open",
      strategyId: "MOMENTUM_CONTINUATION",
      entryPolicyVersion: "pr03-v1",
      entryAtMs: baseNow,
      fills: [{ price: 100, quantity: 1, fee: 0, atMs: baseNow }],
      riskReference: buildRiskReference({
        entryPrice: 100,
        initialStopPrice: 99.2,
        initialQuantity: 1,
        entryFee: 0,
        includesFeesInBreakEven: true,
        computedAtMs: baseNow,
      }),
      invalidation,
      featureEvidenceIds: [],
      dataSource: "SYNTHETIC_FIXTURE",
      replayWindow: { fromMs: baseNow, toMs: baseNow + 120_000 },
    });
    const ticks = [{ tickIndex: 0, observation: obs(100, 1000) }];
    const result = runPortfolioReplay({
      datasetId: "eq-open",
      lifecycleRows: [{ lifecycleId: "eq-open", eventAtMs: baseNow, labelEndAtMs: baseNow + 120_000, manifest: m }],
      policyId: "STRUCTURAL_STOP_TARGET",
      ticksByManifestId: { [m.manifestId]: ticks },
      startingCapital: 100,
      maxConcurrentPositions: 1,
    });
    expect(result.availableCash).toBe(0);
    expect(result.openPositionMarketValue).toBe(100);
    expect(result.endingEquity).toBe(100);
  });

  it("25 partial 0.5 @110 ve kalan 0.5 mark 110 ise equity 110 olur", () => {
    const m = buildMatchedEntryManifest({
      entrySignalId: "eq-partial",
      strategyId: "MOMENTUM_CONTINUATION",
      entryPolicyVersion: "pr03-v1",
      entryAtMs: baseNow,
      fills: [{ price: 100, quantity: 1, fee: 0, atMs: baseNow }],
      riskReference: buildRiskReference({
        entryPrice: 100,
        initialStopPrice: 99.2,
        initialQuantity: 1,
        entryFee: 0,
        includesFeesInBreakEven: true,
        computedAtMs: baseNow,
      }),
      invalidation,
      featureEvidenceIds: [],
      dataSource: "SYNTHETIC_FIXTURE",
      replayWindow: { fromMs: baseNow, toMs: baseNow + 120_000 },
    });
    const ticks = [
      { tickIndex: 0, observation: obs(103, 1000) },
      { tickIndex: 1, observation: obs(110, 2000), applyFill: { price: 110, quantity: 0.5, fee: 0, feeAsset: "QUOTE" as const } },
      { tickIndex: 2, observation: obs(110, 3000) },
    ];
    const result = runPortfolioReplay({
      datasetId: "eq-partial",
      lifecycleRows: [{ lifecycleId: "eq-partial", eventAtMs: baseNow, labelEndAtMs: baseNow + 120_000, manifest: m }],
      policyId: "STRUCTURAL_PARTIAL_TRAIL",
      ticksByManifestId: { [m.manifestId]: ticks },
      startingCapital: 100,
      maxConcurrentPositions: 1,
    });
    expect(result.availableCash).toBe(55);
    expect(result.openPositionMarketValue).toBe(55);
    expect(result.endingEquity).toBe(110);
  });
});

describe("REPLAY correction — quote causality", () => {
  it("26 gelecekteki fiyat gecmise fallback olamaz", () => {
    const quote = findMarketQuoteAtMs(
      [{
        observation: {
          eventAtMs: 2000,
          availableAtMs: 3000,
          markPrice: 110,
        },
      }],
      1000,
    );
    expect(quote).toBeNull();
  });
});
