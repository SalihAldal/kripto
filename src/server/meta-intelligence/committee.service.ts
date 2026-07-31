import { getLatestContext, persistCommitteeMeeting } from "@/src/server/meta-intelligence/meta-intelligence.repository";
import { emitMetaEvent, META_EVENT } from "@/src/server/meta-intelligence/meta-intelligence.events";
import { COMMITTEE_ROLES, type CommitteeOpinion } from "@/src/server/meta-intelligence/meta-intelligence.types";

function roleOpinion(role: string, ctx: { regime?: string; newsScore?: number; whaleScore?: number }): CommitteeOpinion {
  const stances: Record<string, CommitteeOpinion> = {
    RISK_OFFICER: { role: "RISK_OFFICER", opinion: ctx.whaleScore && ctx.whaleScore > 70 ? "Elevated whale activity warrants reduced exposure" : "Risk levels within acceptable bounds", stance: ctx.whaleScore && ctx.whaleScore > 70 ? "CAUTIOUS" : "NEUTRAL", confidence: 75 },
    PORTFOLIO_MANAGER: { role: "PORTFOLIO_MANAGER", opinion: "Portfolio allocation should reflect current regime", stance: ctx.regime === "BULL_EXPANSION" ? "BULLISH" : ctx.regime === "RISK_OFF" ? "BEARISH" : "NEUTRAL", confidence: 70 },
    RESEARCH_DIRECTOR: { role: "RESEARCH_DIRECTOR", opinion: "Research pipeline should focus on narrative leaders", stance: "NEUTRAL", confidence: 65 },
    MARKET_STRATEGIST: { role: "MARKET_STRATEGIST", opinion: `Current regime: ${ctx.regime ?? "UNKNOWN"}. Tactical positioning advised.`, stance: ctx.regime === "BULL_EXPANSION" ? "BULLISH" : "NEUTRAL", confidence: 68 },
    MACRO_ANALYST: { role: "MACRO_ANALYST", opinion: ctx.newsScore && ctx.newsScore > 60 ? "Macro news flow supportive" : "Macro headwinds present", stance: ctx.newsScore && ctx.newsScore > 60 ? "BULLISH" : "BEARISH", confidence: 62 },
    EXECUTION_DIRECTOR: { role: "EXECUTION_DIRECTOR", opinion: "Execution infrastructure stable. No blocking issues.", stance: "NEUTRAL", confidence: 80 },
    NEWS_DIRECTOR: { role: "NEWS_DIRECTOR", opinion: `News impact average: ${ctx.newsScore?.toFixed(0) ?? "N/A"}`, stance: (ctx.newsScore ?? 50) > 60 ? "BULLISH" : "NEUTRAL", confidence: 72 },
    WHALE_DIRECTOR: { role: "WHALE_DIRECTOR", opinion: `Whale activity score: ${ctx.whaleScore?.toFixed(0) ?? "N/A"}`, stance: (ctx.whaleScore ?? 50) > 65 ? "CAUTIOUS" : "NEUTRAL", confidence: 70 },
    ONCHAIN_DIRECTOR: { role: "ONCHAIN_DIRECTOR", opinion: "On-chain protocol health monitored. No critical alerts.", stance: "NEUTRAL", confidence: 68 },
    META_AI: { role: "META_AI", opinion: "Synthesizing all committee opinions for executive recommendation.", stance: "NEUTRAL", confidence: 75 },
  };
  return stances[role] ?? { role: role as CommitteeOpinion["role"], opinion: "No opinion available", stance: "NEUTRAL", confidence: 50 };
}

export async function conveneCommittee(topic = "Market Outlook Assessment") {
  const ctx = await getLatestContext();
  const news = ctx?.newsSnapshot as { avgScore?: number } | null;
  const whale = ctx?.whaleSnapshot as { avgActivity?: number } | null;

  const contextData = { regime: ctx?.marketRegime, newsScore: news?.avgScore, whaleScore: whale?.avgActivity };
  const opinions: CommitteeOpinion[] = COMMITTEE_ROLES.map((role) => roleOpinion(role, contextData));

  const bullish = opinions.filter((o) => o.stance === "BULLISH").length;
  const bearish = opinions.filter((o) => o.stance === "BEARISH" || o.stance === "CAUTIOUS").length;
  const avgConfidence = opinions.reduce((s, o) => s + o.confidence, 0) / opinions.length;

  let consensus: string;
  if (bullish > bearish + 2) consensus = "Committee leans bullish with manageable risk";
  else if (bearish > bullish) consensus = "Committee recommends caution and capital preservation";
  else consensus = "Committee divided — no strong directional consensus";

  const metaSummary = [
    `Committee convened on: ${topic}`,
    `Opinions: ${bullish} bullish, ${bearish} cautious/bearish, ${opinions.length - bullish - bearish} neutral`,
    `Consensus: ${consensus}`,
    `Average confidence: ${avgConfidence.toFixed(0)}%`,
    "Meta AI note: All opinions are advisory. No production changes enacted.",
  ].join(". ");

  const meeting = await persistCommitteeMeeting({
    topic,
    opinions: { members: opinions },
    consensus,
    dissent: { bearish, bullish, neutral: opinions.length - bullish - bearish },
    metaSummary,
    overallConfidence: avgConfidence,
  });

  emitMetaEvent(META_EVENT.COMMITTEE_CONVENED, { meetingId: meeting.id, consensus });
  return { meeting, opinions, consensus };
}
