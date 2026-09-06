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
  let lastEligible: { markPrice: number; eventAtMs: number; availableAtMs: number } | null = null;
  const sorted = [...ticks].sort((a, b) => {
    if (a.observation.eventAtMs !== b.observation.eventAtMs) {
      return a.observation.eventAtMs - b.observation.eventAtMs;
    }
    return a.observation.availableAtMs - b.observation.availableAtMs;
  });
  for (const tick of sorted) {
    const obs = tick.observation;
    if (!Number.isFinite(obs.markPrice)) continue;
    if (obs.eventAtMs <= atMs && obs.availableAtMs <= atMs) {
      lastEligible = {
        markPrice: obs.markPrice as number,
        eventAtMs: obs.eventAtMs,
        availableAtMs: obs.availableAtMs,
      };
    }
  }
  return lastEligible?.markPrice ?? null;
}
