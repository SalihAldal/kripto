import type { Pr05TradeOutcome } from "@/src/server/profitability/pr05-types";
import { computeNetExpectancyFromPnls } from "@/src/server/profitability/pr05-metrics";

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function shiftSignalBlocksWithSeed(input: {
  outcomes: Pr05TradeOutcome[];
  seed: number;
  iterations: number;
  shiftBlocks: number;
}) {
  const grouped = new Map<string, Pr05TradeOutcome[]>();
  for (const row of input.outcomes) {
    const arr = grouped.get(row.lifecycleId) ?? [];
    arr.push(row);
    grouped.set(row.lifecycleId, arr);
  }
  const blocks = [...grouped.keys()];
  const realPnls = input.outcomes.filter((o) => o.closed && o.netPnl != null).map((o) => o.netPnl!);
  const realNetExpectancy = computeNetExpectancyFromPnls(realPnls);
  if (!blocks.length || realNetExpectancy == null) {
    return {
      method: "SIGNAL_BLOCK_SHIFT",
      seed: input.seed,
      iterations: input.iterations,
      realNetExpectancy,
      controlNetExpectancies: [] as number[],
      breaksDependency: false,
      verdict: "INSUFFICIENT_DATA" as const,
      reason: "NO_CLOSED_TRADES_OR_BLOCKS",
    };
  }
  const rng = mulberry32(input.seed);
  const controlNetExpectancies: number[] = [];
  for (let i = 0; i < input.iterations; i += 1) {
    const shuffled = [...blocks];
    for (let j = shuffled.length - 1; j > 0; j -= 1) {
      const k = Math.floor(rng() * (j + 1));
      [shuffled[j], shuffled[k]] = [shuffled[k]!, shuffled[j]!];
    }
    const shift = Math.max(1, input.shiftBlocks % shuffled.length);
    const permuted = [...shuffled.slice(shift), ...shuffled.slice(0, shift)];
    const pnlByBlock = new Map<string, number[]>();
    for (const block of blocks) {
      const rows = grouped.get(block) ?? [];
      pnlByBlock.set(
        block,
        rows.filter((o) => o.closed && o.netPnl != null).map((o) => o.netPnl!),
      );
    }
    const permutedPnls: number[] = [];
    for (const block of permuted) {
      permutedPnls.push(...(pnlByBlock.get(block) ?? []));
    }
    const exp = computeNetExpectancyFromPnls(permutedPnls);
    if (exp != null) controlNetExpectancies.push(exp);
  }
  const controlMean =
    controlNetExpectancies.length > 0
      ? controlNetExpectancies.reduce((a, b) => a + b, 0) / controlNetExpectancies.length
      : null;
  const breaksDependency = controlMean != null && Math.abs(controlMean - realNetExpectancy) > 1e-9;
  let verdict: "PASS" | "FAIL" | "NOT_RUN" | "INSUFFICIENT_DATA" = "INSUFFICIENT_DATA";
  if (controlNetExpectancies.length > 0) {
    verdict = breaksDependency ? "PASS" : "FAIL";
  }
  return {
    method: "SIGNAL_BLOCK_SHIFT",
    seed: input.seed,
    iterations: input.iterations,
    realNetExpectancy,
    controlNetExpectancies,
    breaksDependency,
    verdict,
    reason: breaksDependency ? "CONTROL_DISTRIBUTION_DIFFERS" : "CONTROL_MATCHES_REAL",
  };
}

export function detectFutureDataLeakFixture(input: {
  decisionAtMs: number;
  observationAvailableAtMs: number;
}) {
  return input.observationAvailableAtMs > input.decisionAtMs;
}
