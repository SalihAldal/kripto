/** Deterministic tie-break for replay events at the same virtual timestamp. Lower runs first. */
export const REPLAY_EVENT_TIE_BREAK = {
  ENTRY_CANDIDATE: 0,
  ENTRY_FILL: 1,
  MARKET_TICK: 2,
  EXIT_INTENT: 3,
  EXIT_FILL: 4,
  SETTLEMENT: 5,
  POSITION_CLOSE: 6,
} as const;

export type ReplayEventKind = keyof typeof REPLAY_EVENT_TIE_BREAK;

export function compareReplayEvents(a: { atMs: number; tie: number }, b: { atMs: number; tie: number }) {
  if (a.atMs !== b.atMs) return a.atMs - b.atMs;
  return a.tie - b.tie;
}

export function findMarketQuoteAtMs(
  ticks: Array<{ observation: { eventAtMs: number; availableAtMs: number; markPrice: number | null } }>,
  atMs: number,
) {
  let lastEligible: number | null = null;
  let firstAfter: number | null = null;
  for (const tick of ticks) {
    const obs = tick.observation;
    if (obs.eventAtMs <= atMs && obs.availableAtMs <= atMs && obs.markPrice != null) {
      lastEligible = obs.markPrice;
      continue;
    }
    if (obs.eventAtMs > atMs && firstAfter == null && obs.markPrice != null) {
      firstAfter = obs.markPrice;
    }
  }
  return lastEligible ?? firstAfter;
}
