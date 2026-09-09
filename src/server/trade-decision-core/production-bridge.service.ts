import type { ExternalSymbolPanel } from "@/src/server/alpha-engine-v2/external-market-data.types";
import type { StrategyId } from "@/src/server/forensics/p4-regime-strategy-shadow";
import type { SelectedStrategySignal } from "@/src/server/execution/fix01-selected-signal";
import {
  buildEntryOrderIdempotencyKey,
  buildSignalIdempotencyKey,
} from "./execution-idempotency.service";
import {
  buildTradeDecisionCorePositionMetadata,
  enrichSelectedSignalWithEntryIntent,
} from "./production-adapter.service";
import { evaluateUnifiedEntryDecision, getVariantById } from "./trade-decision-core.service";
import type { EntrySignalIntent, MarketSnapshot, StrategyVariantId } from "./types";

export type TradeDecisionCoreBridgeStatus =
  | "disabled"
  | "skipped_no_panel"
  | "skipped_no_bar"
  | "no_signal"
  | "overlay"
  | "blocked_duplicate";

export type TradeDecisionCoreBridgeResult = {
  status: TradeDecisionCoreBridgeStatus;
  selectedSignalOverlay: SelectedStrategySignal | null;
  entryIntent: EntrySignalIntent | null;
  signalIdempotencyKey: string | null;
  blockEntry: boolean;
  blockReason: string | null;
  metadataPatch: Record<string, unknown>;
};

function parseExternalPanel(metadata: Record<string, unknown>): ExternalSymbolPanel | null {
  const raw =
    metadata.tradeDecisionCorePanel ??
    metadata.externalSymbolPanel ??
    metadata.oiExternalPanel;
  if (!raw || typeof raw !== "object") return null;
  const panel = raw as ExternalSymbolPanel;
  if (!Array.isArray(panel.bars) || panel.bars.length === 0) return null;
  if (!panel.symbol) return null;
  return panel;
}

function buildMarketSnapshot(input: {
  metadata: Record<string, unknown>;
  symbol: string;
  decisionAtMs: number;
  panel: ExternalSymbolPanel;
}): MarketSnapshot | null {
  const raw = input.metadata.tradeDecisionCoreBarIdx ?? input.metadata.externalBarIdx;
  let barIdx = raw == null ? input.panel.bars.length - 1 : Number(raw);
  if (!Number.isInteger(barIdx) || barIdx < 0 || barIdx >= input.panel.bars.length) return null;
  while (barIdx >= 0 && input.panel.bars[barIdx].closeTime > input.decisionAtMs) barIdx--;
  if (barIdx < 0) return null;
  // Never substitute an external USDT price/volume for local TRY observations.
  const tryPrice = Number(input.metadata.tryPrice);
  const tryVolume = Number(input.metadata.tryVolume);
  const tryAvailableAtMs = Number(input.metadata.tryAvailableAtMs);
  if (!(tryPrice > 0) || !Number.isFinite(tryVolume) || !Number.isFinite(tryAvailableAtMs)) return null;
  const bar = input.panel.bars[barIdx];
  return {
    nowMs: input.decisionAtMs,
    baseAsset: String(input.metadata.baseAsset ?? input.symbol.replace(/TRY$|USDT$/, "")),
    externalSymbol: input.panel.symbol, executionSymbol: String(input.metadata.executionSymbol ?? input.symbol),
    externalBarIdx: barIdx, externalClose: bar.close,
    tryBarIdx: Number(input.metadata.tryBarIdx ?? -1), tryPrice, tryVolume, tryAvailableAtMs,
    btcExternalReturn4hPct: input.metadata.btcExternalReturn4hPct == null ? null : Number(input.metadata.btcExternalReturn4hPct),
  };
}

export function applyTradeDecisionCoreProductionBridge(input: {
  enabled: boolean;
  variantId: StrategyVariantId;
  candidateMetadata: Record<string, unknown>;
  symbol: string;
  decisionAtMs: number;
  p4SelectedSignal: SelectedStrategySignal | null;
  p4PreferredStrategy: StrategyId | null;
  candidateId: string;
  lifecycleId: string;
  featureSnapshotId: string;
  mode: string;
  fallbackIdempotencyKey: string;
}): TradeDecisionCoreBridgeResult {
  if (!input.enabled) {
    const signalId = input.p4SelectedSignal?.signalId ?? null;
    return {
      status: "disabled",
      selectedSignalOverlay: input.p4SelectedSignal,
      entryIntent: null,
      signalIdempotencyKey: buildEntryOrderIdempotencyKey({
        mode: input.mode,
        symbol: input.symbol,
        signalId,
        fallbackKey: input.fallbackIdempotencyKey,
      }),
      blockEntry: false,
      blockReason: null,
      metadataPatch: {},
    };
  }

  const panel = parseExternalPanel(input.candidateMetadata);
  if (!panel) {
    const signalId = input.p4SelectedSignal?.signalId ?? null;
    return {
      status: "skipped_no_panel",
      selectedSignalOverlay: input.p4SelectedSignal,
      entryIntent: null,
      signalIdempotencyKey: buildEntryOrderIdempotencyKey({
        mode: input.mode,
        symbol: input.symbol,
        signalId,
        fallbackKey: input.fallbackIdempotencyKey,
      }),
      blockEntry: false,
      blockReason: null,
      metadataPatch: { tradeDecisionCoreBridge: "skipped_no_panel" },
    };
  }

  const snapshot = buildMarketSnapshot({
    metadata: input.candidateMetadata,
    symbol: input.symbol,
    decisionAtMs: input.decisionAtMs,
    panel,
  });
  if (!snapshot) {
    return {
      status: "skipped_no_bar",
      selectedSignalOverlay: input.p4SelectedSignal,
      entryIntent: null,
      signalIdempotencyKey: input.fallbackIdempotencyKey,
      blockEntry: false,
      blockReason: null,
      metadataPatch: { tradeDecisionCoreBridge: "skipped_no_bar" },
    };
  }

  const variant = getVariantById(input.variantId);
  const intent = evaluateUnifiedEntryDecision({
    variant,
    panel,
    barIdx: snapshot.externalBarIdx,
    snapshot,
    nowMs: input.decisionAtMs,
  });

  if (!intent) {
    const signalId = input.p4SelectedSignal?.signalId ?? null;
    return {
      status: "no_signal",
      selectedSignalOverlay: input.p4SelectedSignal,
      entryIntent: null,
      signalIdempotencyKey: buildEntryOrderIdempotencyKey({
        mode: input.mode,
        symbol: input.symbol,
        signalId,
        fallbackKey: input.fallbackIdempotencyKey,
      }),
      blockEntry: false,
      blockReason: null,
      metadataPatch: { tradeDecisionCoreBridge: "no_signal", tradeDecisionCoreVariant: input.variantId },
    };
  }

  const duplicateP4Runtime =
    Boolean(input.p4PreferredStrategy) &&
    Boolean(input.p4SelectedSignal?.signalId) &&
    input.p4SelectedSignal?.signalId !== intent.signalId;

  if (duplicateP4Runtime) {
    return {
      status: "blocked_duplicate",
      selectedSignalOverlay: input.p4SelectedSignal,
      entryIntent: intent,
      signalIdempotencyKey: buildSignalIdempotencyKey(intent.signalId),
      blockEntry: true,
      blockReason: "TRADE_DECISION_CORE_ENABLED: P4 ve TDC aynı aday için çakışan sinyal üretti",
      metadataPatch: {
        tradeDecisionCoreBridge: "blocked_duplicate",
        tradeDecisionCoreSignalId: intent.signalId,
        p4SignalId: input.p4SelectedSignal?.signalId ?? null,
      },
    };
  }

  const overlay = enrichSelectedSignalWithEntryIntent({
    base: input.p4SelectedSignal,
    intent,
    candidateId: input.candidateId,
    lifecycleId: input.lifecycleId,
    featureSnapshotId: input.featureSnapshotId,
    carrierStrategyId: input.p4PreferredStrategy ?? undefined,
  });

  return {
    status: "overlay",
    selectedSignalOverlay: overlay,
    entryIntent: intent,
    signalIdempotencyKey: buildSignalIdempotencyKey(intent.signalId),
    blockEntry: false,
    blockReason: null,
    metadataPatch: {
      tradeDecisionCoreBridge: "overlay",
      ...buildTradeDecisionCorePositionMetadata(intent),
    },
  };
}
