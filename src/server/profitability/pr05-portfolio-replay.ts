import type { ExitPolicyId } from "@/src/server/profitability/pr04-types";
import type { MatchedEntryManifest } from "@/src/server/profitability/pr04-types";
import { runPr04ExitReplayWithOutcome, type Pr04ExitReplayTick } from "@/src/server/profitability/pr04-replay";
import type { Pr05LifecycleRow, Pr05TradeOutcome } from "@/src/server/profitability/pr05-types";

export function runPortfolioReplay(input: {
  datasetId: string;
  lifecycleRows: Pr05LifecycleRow[];
  policyId: ExitPolicyId;
  ticksByManifestId: Record<string, Pr04ExitReplayTick[]>;
  startingCapital: number;
  maxConcurrentPositions: number;
}) {
  const sorted = [...input.lifecycleRows].sort((a, b) => a.eventAtMs - b.eventAtMs);
  const outcomes: Pr05TradeOutcome[] = [];
  let availableCapital = input.startingCapital;
  let openCount = 0;
  for (const row of sorted) {
    if (openCount >= input.maxConcurrentPositions) continue;
    const entryNotional = row.manifest.fills.reduce((acc, fill) => acc + fill.price * fill.quantity, 0);
    if (entryNotional > availableCapital) continue;
    const ticks = input.ticksByManifestId[row.manifest.manifestId] ?? [];
    const replay = runPr04ExitReplayWithOutcome({
      datasetId: input.datasetId,
      manifest: row.manifest,
      policyId: input.policyId,
      ticks,
    });
    const netPnl = replay.pnl?.realizedNetPnl ?? null;
    const closed = replay.closed;
    const censored = replay.terminalStatus === "CENSORED" || replay.terminalStatus === "OPEN";
    if (closed && netPnl != null) {
      availableCapital += netPnl;
      openCount = Math.max(0, openCount - 1);
    } else if (!closed) {
      openCount += 1;
      availableCapital = Math.max(0, availableCapital - entryNotional);
    }
    const lastTick = ticks.length ? ticks[ticks.length - 1]!.observation.eventAtMs : row.manifest.replayWindow.toMs;
    outcomes.push({
      manifestId: row.manifest.manifestId,
      lifecycleId: row.lifecycleId,
      strategyId: row.manifest.strategyId,
      exitPolicyId: input.policyId,
      split: "UNASSIGNED",
      entryAtMs: row.manifest.entryAtMs,
      closed,
      censored,
      grossPnl: replay.pnl?.realizedGrossPnl ?? null,
      netPnl,
      fees: replay.pnl?.realizedFees ?? 0,
      rMultiple: replay.rMultiple,
      holdingMs: closed ? lastTick - row.manifest.entryAtMs : null,
      symbol: row.manifest.symbol ?? null,
      regime: row.manifest.regime ?? null,
      pnlStatus: replay.pnl?.status ?? "UNKNOWN",
      equalRiskComparable: row.manifest.riskReference.quality === "VALID",
    });
  }
  return {
    outcomes,
    endingCapital: availableCapital,
    acceptedLifecycles: outcomes.length,
    rejectedForCapital: sorted.length - outcomes.length,
  };
}
