import { clamp } from "@/src/server/opportunity/normalize";
import type { AiAdvisory, AiAdvisoryDecision, AiAdvisoryStatus } from "@/src/server/microstructure/types";

const DECISIONS = new Set<AiAdvisoryDecision>(["BULLISH_CONTEXT", "NEUTRAL", "CAUTION", "NO_OPINION"]);

export function parseAiAdvisory(raw: unknown, maxModifier: number): AiAdvisory {
  if (!raw || typeof raw !== "object") {
    return { status: "INVALID", decision: "NO_OPINION", modifier: 0, reason: "AI_INVALID_RESPONSE" };
  }
  const rec = raw as Record<string, unknown>;
  const status = String(rec.status ?? "READY").toUpperCase() as AiAdvisoryStatus;
  if (status === "TIMEOUT") {
    return { status: "TIMEOUT", decision: "NO_OPINION", modifier: 0, reason: "AI_TIMEOUT" };
  }
  if (status === "UNAVAILABLE" || status === "PENDING") {
    return { status, decision: "NO_OPINION", modifier: 0, reason: `AI_${status}` };
  }
  const decisionRaw = String(rec.decision ?? rec.opinion ?? "NO_OPINION").toUpperCase().replace(/\s+/g, "_");
  const decision = (DECISIONS.has(decisionRaw as AiAdvisoryDecision) ? decisionRaw : "NO_OPINION") as AiAdvisoryDecision;
  if (decision === "NO_OPINION" || decision === "NEUTRAL") {
    return { status: "READY", decision, modifier: 0, reason: decision === "NO_OPINION" ? "AI_NO_OPINION" : "AI_NEUTRAL" };
  }
  const confidence = Number(rec.confidence ?? 50);
  const signed = decision === "CAUTION" ? -1 : 1;
  const modifier = clamp(signed * Math.min(maxModifier, (Number.isFinite(confidence) ? confidence : 50) * 0.08), -maxModifier, maxModifier);
  return { status: "READY", decision, modifier: Number(modifier.toFixed(2)), reason: decision };
}

export function neutralAi(status: AiAdvisoryStatus = "UNAVAILABLE"): AiAdvisory {
  return { status, decision: "NO_OPINION", modifier: 0, reason: `AI_${status}` };
}

export function compactAiContext(input: {
  symbol: string;
  lane: string;
  opportunityScore: number;
  microScore: number;
  return5m: number;
  takerBuyRatio5s: number;
  spreadBps: number;
  exhaustion: number;
  btcReturn1m?: number;
}) {
  return {
    symbol: input.symbol,
    lane: input.lane,
    opportunityScore: Number(input.opportunityScore.toFixed(1)),
    microScore: Number(input.microScore.toFixed(1)),
    return5m: Number(input.return5m.toFixed(3)),
    takerBuyRatio5s: Number(input.takerBuyRatio5s.toFixed(3)),
    spreadBps: Number(input.spreadBps.toFixed(2)),
    exhaustion: Number(input.exhaustion.toFixed(3)),
    btcReturn1m: input.btcReturn1m ?? 0,
  };
}
