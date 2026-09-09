/** Machine-readable boundary between live paper production and historical replay. */
export const PRODUCTION_REPLAY_BOUNDARY = Object.freeze({
  replayable: [
    "evaluateEntrySignal (OI family)",
    "evaluateLocalConfirmedEntry",
    "evaluateEconBreakoutEntry",
    "evaluateMinuteExpansionEntry (research only)",
    "runTrySpotReplayUniverse portfolio mechanics",
    "PR04 exit replay tick",
  ],
  notReplayable: [
    "OpportunityEngine.scan",
    "MicrostructureEngine.evaluate",
    "pump-early-catcher live path",
    "AI consensus (3-provider)",
    "P4 strategy router (live features)",
    "news sentiment",
    "order book L2",
    "liquidation feed",
    "paper exchange simulator latency",
  ],
  approximations: [
    "CLOSED_BAR_MINUTE_FILL — fills at positive-volume minute close, not queue position",
    "PARTICIPATION_RATE_CAP — partial fill vs bar volume",
    "NO_CROSS_SECTIONAL_SCANNER — replay evaluates per-symbol panels, not live hot-store ranking",
  ],
  dataAlreadySeen: "2025-09-01..2026-08-31 deep dataset; no claim of unseen holdout unless forward paper",
  forwardValidationRequired: true,
});

export type ReplayEquivalenceClaim = "FULL" | "PARTIAL_ENTRY_EXIT_ONLY" | "NOT_CLAIMED";

export function replayEquivalenceForVariant(entryCandidate: string): ReplayEquivalenceClaim {
  if (entryCandidate.startsWith("econ_") || entryCandidate.startsWith("local_")) return "PARTIAL_ENTRY_EXIT_ONLY";
  if (entryCandidate.startsWith("baseline_oi") || entryCandidate.startsWith("entry_")) return "PARTIAL_ENTRY_EXIT_ONLY";
  return "NOT_CLAIMED";
}
