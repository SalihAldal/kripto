export class LookaheadViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LookaheadViolationError";
  }
}

export function assertNoLookahead(decisionTime: number, featureTimestamp: number, featureName: string) {
  if (featureTimestamp > decisionTime) {
    throw new LookaheadViolationError(
      `Lookahead detected: feature ${featureName} at ${featureTimestamp} > decision ${decisionTime}`,
    );
  }
}

export function filterFeaturesAtOrBefore<T extends { timestamp: number }>(rows: T[], decisionTime: number) {
  return rows.filter((row) => row.timestamp <= decisionTime);
}

export function latestAtOrBefore<T extends { timestamp: number }>(rows: T[], decisionTime: number): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (row.timestamp <= decisionTime) best = row;
  }
  return best;
}
