import {
  getExitPolicyState,
  resetExitPolicyStoreForTests,
} from "@/src/server/profitability/pr04-exit-evaluator";
import { buildExitPnlSnapshot } from "@/src/server/profitability/pr04-pnl-accounting";
import { computeRMultiple } from "@/src/server/profitability/pr04-structural-stop";
import type { ExitPolicyId } from "@/src/server/profitability/pr04-types";
import type { MatchedEntryManifest } from "@/src/server/profitability/pr04-types";
import {
  createPr04ExitReplaySession,
  finalizePr04ExitReplaySession,
  stepPr04ExitReplayTick,
  type Pr04ExitReplayTick,
} from "@/src/server/profitability/pr04-replay";
import { compareReplayEvents, REPLAY_EVENT_TIE_BREAK } from "@/src/server/profitability/pr05-replay-clock";
import type { Pr05LifecycleRow, Pr05TradeOutcome } from "@/src/server/profitability/pr05-types";

type PortfolioEvent =
  | { atMs: number; tie: number; kind: "ENTRY_CANDIDATE"; row: Pr05LifecycleRow }
  | { atMs: number; tie: number; kind: "EXIT_TICK"; lifecycleId: string; tick: Pr04ExitReplayTick };

type ActivePosition = {
  lifecycleId: string;
  manifest: MatchedEntryManifest;
  entryCost: number;
  session: ReturnType<typeof createPr04ExitReplaySession>;
  closed: boolean;
  closedAtMs: number | null;
};

export type PortfolioReplayRejection = {
  lifecycleId: string;
  atMs: number;
  reasonCode: "POSITION_LIMIT" | "INSUFFICIENT_CAPITAL";
};

export function runPortfolioReplay(input: {
  datasetId: string;
  lifecycleRows: Pr05LifecycleRow[];
  policyId: ExitPolicyId;
  ticksByManifestId: Record<string, Pr04ExitReplayTick[]>;
  startingCapital: number;
  maxConcurrentPositions: number;
}) {
  resetExitPolicyStoreForTests();
  const events: PortfolioEvent[] = [];
  for (const row of input.lifecycleRows) {
    events.push({
      atMs: row.eventAtMs,
      tie: REPLAY_EVENT_TIE_BREAK.ENTRY_CANDIDATE,
      kind: "ENTRY_CANDIDATE",
      row,
    });
    for (const tick of input.ticksByManifestId[row.manifest.manifestId] ?? []) {
      events.push({
        atMs: tick.observation.eventAtMs,
        tie: REPLAY_EVENT_TIE_BREAK.MARKET_TICK,
        kind: "EXIT_TICK",
        lifecycleId: row.lifecycleId,
        tick,
      });
    }
  }
  events.sort(compareReplayEvents);

  let availableCash = input.startingCapital;
  const active = new Map<string, ActivePosition>();
  const admitted = new Set<string>();
  const rejections: PortfolioReplayRejection[] = [];
  const outcomes: Pr05TradeOutcome[] = [];

  for (const event of events) {
    if (event.kind === "ENTRY_CANDIDATE") {
      const row = event.row;
      if (admitted.has(row.lifecycleId)) continue;
      if (active.size >= input.maxConcurrentPositions) {
        rejections.push({ lifecycleId: row.lifecycleId, atMs: event.atMs, reasonCode: "POSITION_LIMIT" });
        continue;
      }
      const entryNotional = row.manifest.fills.reduce((acc, fill) => acc + fill.price * fill.quantity, 0);
      const entryFee = row.manifest.fills.reduce((acc, fill) => acc + fill.fee, 0);
      const entryCost = entryNotional + entryFee;
      if (entryCost > availableCash) {
        rejections.push({ lifecycleId: row.lifecycleId, atMs: event.atMs, reasonCode: "INSUFFICIENT_CAPITAL" });
        continue;
      }
      availableCash -= entryCost;
      const session = createPr04ExitReplaySession({
        manifest: row.manifest,
        policyId: input.policyId,
      });
      active.set(row.lifecycleId, {
        lifecycleId: row.lifecycleId,
        manifest: row.manifest,
        entryCost,
        session,
        closed: false,
        closedAtMs: null,
      });
      admitted.add(row.lifecycleId);
      continue;
    }

    const position = active.get(event.lifecycleId);
    if (!position || position.closed) continue;
    if (event.tick.observation.eventAtMs < position.manifest.entryAtMs) continue;

    const step = stepPr04ExitReplayTick(position.session, event.tick);
    if (step.fillApplied && event.tick.applyFill) {
      const fill = event.tick.applyFill;
      availableCash += fill.price * fill.quantity - fill.fee;
    }
    if (step.closed) {
      position.closed = true;
      position.closedAtMs = position.session.closedAtMs ?? event.atMs;
      finalizePr04ExitReplaySession(position.session);
      const finalState = getExitPolicyState(position.session.positionId);
      const pnl = finalState
        ? buildExitPnlSnapshot({
            state: finalState,
            markPrice: event.tick.observation.markPrice,
            side: "LONG",
          })
        : null;
      const closed = finalState?.terminalStatus === "CLOSED";
      const censored = finalState?.terminalStatus === "CENSORED" || finalState?.terminalStatus === "OPEN";
      outcomes.push({
        manifestId: position.manifest.manifestId,
        lifecycleId: position.lifecycleId,
        strategyId: position.manifest.strategyId,
        exitPolicyId: input.policyId,
        split: "UNASSIGNED",
        entryAtMs: position.manifest.entryAtMs,
        closed,
        censored,
        grossPnl: pnl?.realizedGrossPnl ?? null,
        netPnl: pnl?.realizedNetPnl ?? null,
        fees: pnl?.realizedFees ?? 0,
        rMultiple:
          finalState && pnl?.realizedNetPnl != null
            ? computeRMultiple({ realizedNetPnl: pnl.realizedNetPnl, riskReference: finalState.riskReference })
            : null,
        holdingMs: position.closedAtMs != null ? position.closedAtMs - position.manifest.entryAtMs : null,
        symbol: position.manifest.symbol ?? null,
        regime: position.manifest.regime ?? null,
        pnlStatus: pnl?.status ?? "UNKNOWN",
        equalRiskComparable: position.manifest.riskReference.quality === "VALID",
      });
      active.delete(event.lifecycleId);
    }
  }

  for (const position of active.values()) {
    finalizePr04ExitReplaySession(position.session);
    const ticks = input.ticksByManifestId[position.manifest.manifestId] ?? [];
    const lastMark = ticks.length ? ticks[ticks.length - 1]!.observation.markPrice : null;
    const finalState = getExitPolicyState(position.session.positionId);
    const pnl = finalState ? buildExitPnlSnapshot({ state: finalState, markPrice: lastMark, side: "LONG" }) : null;
    outcomes.push({
      manifestId: position.manifest.manifestId,
      lifecycleId: position.lifecycleId,
      strategyId: position.manifest.strategyId,
      exitPolicyId: input.policyId,
      split: "UNASSIGNED",
      entryAtMs: position.manifest.entryAtMs,
      closed: false,
      censored: true,
      grossPnl: pnl?.realizedGrossPnl ?? null,
      netPnl: pnl?.realizedNetPnl ?? null,
      fees: pnl?.realizedFees ?? 0,
      rMultiple: null,
      holdingMs: null,
      symbol: position.manifest.symbol ?? null,
      regime: position.manifest.regime ?? null,
      pnlStatus: pnl?.status ?? "UNKNOWN",
      equalRiskComparable: position.manifest.riskReference.quality === "VALID",
    });
  }

  let unrealizedMtm = 0;
  for (const position of active.values()) {
    const ticks = input.ticksByManifestId[position.manifest.manifestId] ?? [];
    const lastMark = ticks.length ? ticks[ticks.length - 1]!.observation.markPrice : null;
    const qty = position.manifest.fills.reduce((a, f) => a + f.quantity, 0);
    const entryPrice = position.manifest.fills[0]?.price ?? 0;
    if (lastMark != null && entryPrice > 0) {
      unrealizedMtm += qty * (lastMark - entryPrice);
    }
  }

  return {
    outcomes,
    endingCapital: availableCash,
    endingEquity: availableCash + unrealizedMtm,
    availableCash,
    reservedCash: active.values().reduce((acc, p) => acc + p.entryCost, 0),
    unrealizedMtm,
    acceptedLifecycles: admitted.size,
    rejectedForCapital: rejections.filter((r) => r.reasonCode === "INSUFFICIENT_CAPITAL").length,
    rejectedForPositionLimit: rejections.filter((r) => r.reasonCode === "POSITION_LIMIT").length,
    rejections,
  };
}
