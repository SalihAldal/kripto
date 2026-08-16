import {
  computeConsensusMetrics,
  mapMasterToLegacy,
  resolveEffectiveTradingDecision,
  resolveMasterDecision,
} from "../src/server/decision-engine/conflict-detection.service";
import type { ExpertOpinionResult } from "../src/server/decision-engine/decision-engine.types";

function mk(
  expertType: ExpertOpinionResult["expertType"],
  opinion: ExpertOpinionResult["opinion"],
  score: number,
): ExpertOpinionResult {
  return {
    expertType,
    opinion,
    confidence: score,
    score,
    summary: "diagnostic",
    positiveFactors: [],
    negativeFactors: [],
    topRisks: [],
  };
}

let total = 0;
let oldPass = 0;
let newPass = 0;
let masterWait = 0;
let masterWatchlist = 0;
let masterNoTrade = 0;

for (let momentum = 48; momentum <= 72; momentum += 2) {
  for (let execution = 40; execution <= 58; execution += 2) {
    const opinions = [
      mk("MARKET", "WEAK_BUY", 55),
      mk("MOMENTUM", momentum >= 60 ? "BUY" : "WEAK_BUY", momentum),
      mk("VOLUME", "WEAK_BUY", 52),
      mk("LIQUIDITY", "BUY", 58),
      mk("RISK", "WEAK_BUY", 54),
      mk("NEWS", "WEAK_BUY", 48),
      mk("EXECUTION", "WEAK_BUY", execution),
      mk("LEARNING", "WEAK_BUY", 46),
    ];
    const matrix = {
      market: 55,
      momentum,
      volume: 52,
      liquidity: 58,
      risk: 54,
      news: 48,
      execution,
      learning: 46,
    };
    const metrics = computeConsensusMetrics(opinions, []);
    const master = resolveMasterDecision({ matrix, metrics, opinions, conflicts: [] });
    if (master === "WAIT") masterWait += 1;
    if (master === "WATCHLIST") masterWatchlist += 1;
    if (master === "NO_TRADE") masterNoTrade += 1;

    total += 1;
    const oldLegacy = mapMasterToLegacy(master);
    if (oldLegacy === "BUY") oldPass += 1;

    const effective = resolveEffectiveTradingDecision({
      masterDecision: master,
      hybridDecision: "BUY",
      hybridRejected: false,
      hybridConfidence: 68,
      metrics,
      opinions,
    });
    if (effective.legacyDecision === "BUY") newPass += 1;
  }
}

console.log(
  JSON.stringify(
    {
      syntheticHybridBuyPanels: total,
      masterDecisionDistribution: {
        WAIT: masterWait,
        WATCHLIST: masterWatchlist,
        NO_TRADE: masterNoTrade,
        BUY_or_STRONG: total - masterWait - masterWatchlist - masterNoTrade,
      },
      oldTradingDecisionPassRatePct: Number(((oldPass / total) * 100).toFixed(1)),
      newTradingDecisionPassRatePct: Number(((newPass / total) * 100).toFixed(1)),
      deltaPassRatePctPoints: Number((((newPass - oldPass) / total) * 100).toFixed(1)),
    },
    null,
    2,
  ),
);
