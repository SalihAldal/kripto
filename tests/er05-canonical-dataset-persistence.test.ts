import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { persistShadowOutcomes } from "@/src/server/shadow-outcome/persist";
import { resetShadowOutcomeEngineForTests, ShadowOutcomeEngine } from "@/src/server/shadow-outcome/shadow-outcome-engine";
import { clearForensicSession, setForensicSession, type ForensicSessionContext } from "@/src/server/forensics/forensic-context";
import type { OpportunityCandidate } from "@/src/server/opportunity/types";

const T0 = 1_700_100_000_000;

type ShadowRow = Record<string, unknown>;
const shadowRows = new Map<string, ShadowRow>();

const prismaMock = {
  shadowCandidateOutcome: {
    findUnique: vi.fn(async (args: { where: { candidateId: string } }) => {
      const found = shadowRows.get(args.where.candidateId);
      return found ? { snapshot: found.snapshot } : null;
    }),
    upsert: vi.fn(async (args: { where: { candidateId: string }; create: ShadowRow; update: ShadowRow }) => {
      const existing = shadowRows.get(args.where.candidateId);
      if (existing) {
        const merged = { ...existing, ...args.update };
        shadowRows.set(args.where.candidateId, merged);
        return merged;
      }
      shadowRows.set(args.where.candidateId, args.create);
      return args.create;
    }),
  },
  shadowMoverEvent: {
    upsert: vi.fn(async () => ({})),
  },
};

vi.mock("@/src/server/db/prisma", () => ({ prisma: prismaMock }));

function opp(symbol = "AAAUSDT", extra: Partial<OpportunityCandidate> = {}): OpportunityCandidate {
  return {
    candidateId: extra.candidateId ?? `${symbol}:${extra.firstDetectedAt ?? T0}`,
    symbol,
    primaryLane: "EARLY",
    secondaryEvidence: [],
    score: 82,
    laneScores: { EARLY: 82, STEADY: 60, MOMENTUM: 40, CONTINUATION: 20 },
    breakdown: {
      priceVelocity: 18,
      priceAcceleration: 20,
      volumeAcceleration: 14,
      relativeVolume: 12,
      relativeStrength: 8,
      breakout: 6,
      compressionExpansion: 4,
      consistency: 6,
      retracementQuality: 5,
      exhaustion: -2,
      chaseControl: -1,
      liquidity: 8,
    },
    features: {
      return1s: 0.1,
      return5s: 0.3,
      return15s: 0.5,
      return30s: 0.7,
      return1m: 0.9,
      return3m: 1.1,
      return5m: 1.3,
      return15m: 1.6,
      change24h: 1.2,
      velocity5s: 1.2,
      velocity15s: 0.8,
      velocity30s: 0.5,
      velocity1m: 0.4,
      priceAccelerationShort: 0.6,
      priceAccelerationMedium: 0.3,
      accelerationConsistency: 0.5,
      volume1m: 120_000,
      volume3m: 200_000,
      volume5m: 280_000,
      rvol1m: 2.4,
      rvol3m: 1.8,
      rvol5m: 1.5,
      volumeAcceleration: 40_000,
      relativeStrengthBTC1m: 0.7,
      relativeStrengthBTC5m: 0.9,
      relativeStrengthMarket: 0.6,
      distanceTo3mHigh: 0.1,
      distanceTo5mHigh: 0.12,
      breakout3m: 0.4,
      breakout5m: 0.3,
      compressionScore: 0.4,
      expansionScore: 0.5,
      maxRetracement: 0.2,
      retracementRatio: 0.1,
      recoverySpeed: 0.4,
      momentumConsistency: 0.6,
      exhaustionScore: 8,
      chaseRisk: 2,
      quoteVolume24h: 5_000_000,
    },
    reasonCodes: ["EARLY_PRICE_ACCELERATION"],
    state: "DISCOVERED",
    firstDetectedAt: T0,
    firstDetectionPrice: 100,
    lastScoreAt: T0,
    lastEvidenceAt: T0,
    currentPrice: 100,
    scansWithoutEvidence: 0,
    deepSubscribed: false,
    ...extra,
  };
}

function buildForensicSession(): ForensicSessionContext {
  return {
    sessionId: "s-er05",
    campaignId: "cmp-er05",
    runId: "run-er05",
    mode: "paper",
    startedAt: new Date(T0).toISOString(),
    terminals: [],
    scannerCycles: [],
    candidates: [],
    aiCalls: [],
    consensus: [],
    evAudits: [],
    decisions: [],
    riskSizing: [],
    orders: [],
    pnlEntries: [],
    rejectionCountsByStage: {},
    rejectionCountsByReason: {},
  };
}

describe("ER05 canonical dataset persistence wiring", () => {
  beforeEach(() => {
    shadowRows.clear();
    vi.clearAllMocks();
    resetShadowOutcomeEngineForTests(new ShadowOutcomeEngine({ persistEveryMs: 0, minTrackScore: 50 }));
    setForensicSession(buildForensicSession());
  });

  afterEach(() => {
    clearForensicSession();
    resetShadowOutcomeEngineForTests();
  });

  it("runs producer -> canonical builder -> persistence chain", async () => {
    const engine = resetShadowOutcomeEngineForTests(new ShadowOutcomeEngine({ persistEveryMs: 0, minTrackScore: 50 }));
    const id = "AAAUSDT:" + T0;
    engine.observeOpportunity([opp("AAAUSDT", { candidateId: id, firstDetectionPrice: 100 })], { now: T0, source: "replay" });
    for (let i = 1; i <= 65; i += 1) {
      const t = T0 + i * 60_000;
      engine.ingestPrice("AAAUSDT", { t, price: 100 + i * 0.1 }, t);
    }
    const first = await persistShadowOutcomes();
    expect(first.wrote).toBe(1);
    const saved = shadowRows.get(id);
    const canonical = (saved?.snapshot as Record<string, unknown>)?.canonicalDataset as Record<string, unknown>;
    expect(canonical?.schemaVersion).toBe("er05-dataset-v1");
    expect((canonical?.observation as Record<string, unknown>)?.candidateId).toBe(id);
    const byBaseline = canonical?.horizonsByBaseline as Record<string, Array<Record<string, unknown>>>;
    expect(Array.isArray(byBaseline?.FIRST_DETECTED)).toBe(true);
    expect((byBaseline?.FIRST_DETECTED ?? []).length).toBeGreaterThan(0);
  });

  it("keeps first-detection immutable across repeated upserts", async () => {
    const engine = resetShadowOutcomeEngineForTests(new ShadowOutcomeEngine({ persistEveryMs: 0, minTrackScore: 50 }));
    const id = "IMMUSDT:" + T0;
    engine.observeOpportunity([opp("IMMUSDT", { candidateId: id, firstDetectionPrice: 100, state: "DISCOVERED" })], { now: T0, source: "replay" });
    await persistShadowOutcomes();
    engine.observeOpportunity([opp("IMMUSDT", { candidateId: id, firstDetectionPrice: 140, score: 95, state: "HOT" })], { now: T0 + 30_000, source: "replay" });
    await persistShadowOutcomes();
    const saved = shadowRows.get(id);
    const canonical = (saved?.snapshot as Record<string, unknown>)?.canonicalDataset as Record<string, unknown>;
    const observation = canonical?.observation as Record<string, unknown>;
    expect(observation.firstDetectedPrice).toBe(100);
  });
});
