import { grossReturnPct, resolveRoundTripCostPct } from "@/src/server/alpha-engine-v2/cost-model-v2.service";
import { computeAlphaStats } from "@/src/server/alpha-engine-v2/validation-framework.service";
import {
  createPr04ExitReplaySession,
  finalizePr04ExitReplaySession,
  stepPr04ExitReplayTick,
} from "@/src/server/profitability/pr04-replay";
import { resetExitPolicyStoreForTests } from "@/src/server/profitability/pr04-exit-evaluator";
import { buildMatchedEntryManifest } from "@/src/server/profitability/pr04-matched-entry-manifest";
import { buildRiskReference } from "@/src/server/profitability/pr04-structural-stop";
import type { InvalidationContract } from "@/src/server/profitability/pr03-types";
import type { ExitPolicyId, ExitTickObservation } from "@/src/server/profitability/pr04-types";
import { evaluateEntrySignal } from "@/src/server/trade-decision-core/entry-signal.service";
import { attributeEntryLosses } from "@/src/server/trade-decision-core/entry-loss-attribution.service";
import type { TrySpotPanel } from "@/src/server/trade-decision-core/try-dataset-loader.service";
import type {
  MarketSnapshot,
  StrategyVariantConfig,
  TryBar,
  TrySpotTradeRecord,
  UnifiedReplayConfig,
} from "@/src/server/trade-decision-core/types";

const MS_HOUR = 3_600_000;

function findTryIdxAfter(bars: TryBar[], afterMs: number) {
  let lo = 0;
  let hi = bars.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].openTime > afterMs) {
      ans = mid;
      hi = mid - 1;
    } else lo = mid + 1;
  }
  return ans;
}

function buildTryIndexByHour(externalBars: Array<{ closeTime: number }>, tryBars: TryBar[]) {
  const map = new Map<number, number>();
  for (const bar of externalBars) {
    const idx = findTryIdxAfter(tryBars, bar.closeTime);
    if (idx >= 0) map.set(bar.closeTime, idx);
  }
  return map;
}

function applySlippage(price: number, side: "BUY" | "SELL", bps: number) {
  const mult = bps / 10_000;
  return side === "BUY" ? price * (1 + mult) : price * (1 - mult);
}

function btcReturnMap(btcPanel: TrySpotPanel | null) {
  const map = new Map<number, number>();
  if (!btcPanel) return map;
  for (let i = 4; i < btcPanel.bars.length; i += 1) {
    const now = btcPanel.bars[i].close;
    const prev = btcPanel.bars[i - 4].close;
    map.set(btcPanel.bars[i].closeTime, prev > 0 ? ((now - prev) / prev) * 100 : 0);
  }
  return map;
}

function buildInvalidation(price: number, atMs: number): InvalidationContract {
  return {
    referenceLevel: price,
    invalidationThreshold: price * 0.985,
    reasonCode: "OI_ENTRY_SWING_LOW",
    computedAtMs: atMs,
    availableAtMs: atMs,
    validUntilMs: null,
    sourceObservations: ["external_bar_low"],
  };
}

function runPr04ManagedExit(input: {
  tryBars: TryBar[];
  entryIdx: number;
  entryPrice: number;
  notionalTry: number;
  slippageBps: number;
  feePct: number;
  exitPolicyId: ExitPolicyId;
  invalidation: InvalidationContract;
  maxHoldMs: number;
}) {
  resetExitPolicyStoreForTests();
  const qty = input.notionalTry / input.entryPrice;
  const entryFee = input.notionalTry * (input.feePct / 100 / 2);
  const entryAtMs = input.tryBars[input.entryIdx].openTime;
  const riskReference = buildRiskReference({
    entryPrice: input.entryPrice,
    initialStopPrice: input.invalidation.invalidationThreshold,
    initialQuantity: qty,
    entryFee,
    includesFeesInBreakEven: true,
    computedAtMs: entryAtMs,
  });
  const manifest = buildMatchedEntryManifest({
    entrySignalId: `try:${entryAtMs}`,
    strategyId: "MOMENTUM_CONTINUATION",
    entryPolicyVersion: "try-spot-v1",
    entryAtMs,
    fills: [{ price: input.entryPrice, quantity: qty, fee: entryFee, atMs: entryAtMs }],
    riskReference,
    invalidation: input.invalidation,
    featureEvidenceIds: [],
    dataSource: "KRIPTO_DEEP_DATASET",
    replayWindow: { fromMs: entryAtMs, toMs: entryAtMs + input.maxHoldMs },
    symbol: null,
  });
  const session = createPr04ExitReplaySession({ manifest, policyId: input.exitPolicyId, side: "LONG" });
  const endMs = input.tryBars[input.entryIdx].openTime + input.maxHoldMs;
  let exitIdx = input.entryIdx;
  let exitPrice = input.entryPrice;
  let exitReason = "TIME_CAP";
  let exitAtMs = endMs;

  for (let i = input.entryIdx + 1; i < input.tryBars.length; i += 5) {
    const bar = input.tryBars[i];
    if (bar.openTime > endMs) break;
    if (bar.volume <= 0) continue;
    const mark = bar.close;
    const observation: ExitTickObservation = {
      eventId: `tick:${bar.openTime}`,
      eventAtMs: bar.closeTime,
      availableAtMs: bar.closeTime,
      markPrice: mark,
      bid: bar.low,
      ask: bar.high,
      high: bar.high,
      low: bar.low,
      closed: true,
      stale: false,
      dataGap: false,
    };
    const step = stepPr04ExitReplayTick(session, {
      tickIndex: i,
      observation,
    });
    if (step.decisionKind !== "NONE") {
      const fillBar = input.tryBars[Math.min(i + 5, input.tryBars.length - 1)];
      if (fillBar.volume <= 0) continue;
      const fillObs: ExitTickObservation = {
        eventId: `fill:${fillBar.openTime}`,
        eventAtMs: fillBar.openTime,
        availableAtMs: fillBar.openTime,
        markPrice: fillBar.open,
        bid: fillBar.low,
        ask: fillBar.high,
        high: fillBar.high,
        low: fillBar.low,
        closed: true,
        stale: false,
        dataGap: false,
      };
      const filled = stepPr04ExitReplayTick(session, {
        tickIndex: i + 5,
        observation: fillObs,
        applyFill: {
          price: applySlippage(fillBar.open, "SELL", input.slippageBps),
          quantity: qty,
          fee: input.notionalTry * (input.feePct / 100 / 2),
          feeAsset: "QUOTE",
        },
      });
      if (filled.closed) {
        exitIdx = i + 5;
        exitPrice = applySlippage(fillBar.open, "SELL", input.slippageBps);
        exitReason = step.decisionKind;
        exitAtMs = fillBar.openTime;
        break;
      }
    }
  }
  finalizePr04ExitReplaySession(session);
  if (exitReason === "TIME_CAP") {
    let lastIdx = input.entryIdx;
    for (let i = input.entryIdx + 1; i < input.tryBars.length; i += 1) {
      if (input.tryBars[i].openTime > endMs) break;
      if (input.tryBars[i].volume > 0) lastIdx = i;
    }
    const lastBar = input.tryBars[lastIdx];
    exitIdx = lastIdx;
    exitPrice = applySlippage(lastBar.open, "SELL", input.slippageBps);
    exitAtMs = lastBar.openTime;
  }
  return { exitIdx, exitPrice, exitReason, exitAtMs };
}

export function runTrySpotReplayForPanel(input: {
  panel: TrySpotPanel;
  btcPanel: TrySpotPanel | null;
  btcReturns: Map<number, number>;
  config: UnifiedReplayConfig;
  freshPartialStart: number;
}) {
  const trades: TrySpotTradeRecord[] = [];
  const tryBars = input.panel.executionBarsTRY;
  const tryByExternalClose = buildTryIndexByHour(input.panel.bars, tryBars);
  const costPct = input.config.costPct;
  const slipBps = input.config.slippageBpsPerSide;
  const feePct = costPct;
  let nextAvailableMs = 0;

  for (let idx = 48; idx < input.panel.bars.length - 9; idx += 4) {
    const extBar = input.panel.bars[idx];
    if (extBar.closeTime < input.config.periodStart || extBar.closeTime > input.config.periodEnd) continue;
    if (extBar.closeTime < nextAvailableMs) continue;
    const tryIdx = tryByExternalClose.get(extBar.closeTime) ?? -1;
    if (tryIdx < 0 || tryIdx >= tryBars.length - 2) continue;
    const tryBar = tryBars[tryIdx];
    if (tryBar.volume <= 0) continue;

    const snapshot: MarketSnapshot = {
      nowMs: extBar.closeTime,
      baseAsset: input.panel.baseAsset,
      externalSymbol: input.panel.symbol,
      executionSymbol: input.panel.executionSymbol,
      externalBarIdx: idx,
      externalClose: extBar.close,
      tryBarIdx: tryIdx,
      tryPrice: tryBar.close,
      tryVolume: tryBar.volume,
      btcExternalReturn4hPct: input.btcReturns.get(extBar.closeTime) ?? null,
    };

    const signal = evaluateEntrySignal({ variant: input.config.variant, panel: input.panel, barIdx: idx, snapshot });
    if (!signal) continue;

    const entryPrice = applySlippage(tryBar.open, "BUY", slipBps);
    const entryAtMs = tryBar.openTime;
    let exitPrice = entryPrice;
    let exitAtMs = entryAtMs;
    let exitReason = "FIXED_8H";
    let exitIdx = tryIdx;

    if (input.config.variant.exitMode === "fixed_8h") {
      const targetMs = entryAtMs + 8 * MS_HOUR;
      const outIdx = findTryIdxAfter(tryBars, targetMs);
      if (outIdx < 0) continue;
      const outBar = tryBars[outIdx];
      if (outBar.volume <= 0) continue;
      exitIdx = outIdx;
      exitPrice = applySlippage(outBar.open, "SELL", slipBps);
      exitAtMs = outBar.openTime;
    } else {
      const managed = runPr04ManagedExit({
        tryBars,
        entryIdx: tryIdx,
        entryPrice,
        notionalTry: input.config.notionalTry,
        slippageBps: slipBps,
        feePct,
        exitPolicyId: input.config.exitPolicyId,
        invalidation: buildInvalidation(extBar.low, extBar.closeTime),
        maxHoldMs: 48 * MS_HOUR,
      });
      exitIdx = managed.exitIdx;
      exitPrice = managed.exitPrice;
      exitAtMs = managed.exitAtMs;
      exitReason = managed.exitReason;
    }

    const holdBars = tryBars.slice(tryIdx, exitIdx + 1);
    const mfe = holdBars.length
      ? ((Math.max(...holdBars.map((b: TryBar) => b.high)) - entryPrice) / entryPrice) * 100
      : 0;
    const mae = holdBars.length
      ? ((Math.min(...holdBars.map((b: TryBar) => b.low)) - entryPrice) / entryPrice) * 100
      : 0;
    const gross = grossReturnPct("LONG", entryPrice, exitPrice);
    const net = gross - costPct;
    const split: TrySpotTradeRecord["split"] =
      extBar.closeTime >= input.freshPartialStart
        ? "FRESH_PARTIAL"
        : extBar.closeTime < input.config.periodStart + 270 * 24 * MS_HOUR
          ? "TRAIN"
          : "VAL";

    const base = {
      symbol: input.panel.symbol,
      baseAsset: input.panel.baseAsset,
      executionSymbol: input.panel.executionSymbol,
      variantId: input.config.variant.id,
      side: "LONG" as const,
      signalAtMs: signal.signalAtMs,
      entryAtMs,
      exitAtMs,
      entryPrice,
      exitPrice,
      signalTryPrice: tryBar.close,
      grossReturnPct: gross,
      netReturnPct: net,
      costPct,
      exitReason,
      mfePct: mfe,
      maePct: mae,
      split,
      metadataRegimeNegative: (snapshot.btcExternalReturn4hPct ?? 0) <= 0,
    };
    trades.push({
      ...base,
      lossAttribution: attributeEntryLosses(base),
    });
    nextAvailableMs = exitAtMs;
  }
  return trades;
}

export function runTrySpotReplayUniverse(input: {
  panels: TrySpotPanel[];
  btcPanel: TrySpotPanel;
  variant: StrategyVariantConfig;
  periodStart: number;
  periodEnd: number;
  freshPartialStart: number;
}) {
  const costPct = resolveRoundTripCostPct("SPOT", "REALISTIC");
  const config: UnifiedReplayConfig = {
    variant: input.variant,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    freshPartialStart: input.freshPartialStart,
    notionalTry: 1000,
    costPct,
    slippageBpsPerSide: 7,
    maxConcurrentPerSymbol: 1,
    exitPolicyId: input.variant.exitMode === "pr04_trail" ? "STRUCTURAL_STOP_TRAIL" : "BASELINE_FIXED_TP_SL",
  };
  const btcReturns = btcReturnMap(input.btcPanel);
  const all: TrySpotTradeRecord[] = [];
  for (const panel of input.panels) {
    all.push(...runTrySpotReplayForPanel({ panel, btcPanel: input.btcPanel, btcReturns, config, freshPartialStart: input.freshPartialStart }));
  }
  const stats = computeAlphaStats(
    all.map((t) => ({
      symbol: t.symbol,
      side: t.side,
      entryTime: t.entryAtMs,
      exitTime: t.exitAtMs,
      grossReturnPct: t.grossReturnPct,
      fundingPnlPct: 0,
      feeCostPct: t.costPct,
      netReturnPct: t.netReturnPct,
      split: t.split === "FRESH_PARTIAL" ? "TEST" : t.split === "VAL" ? "VALIDATION" : "TRAIN",
      alphaId: t.variantId,
    })),
  );
  return { trades: all, stats, config };
}
