import { refreshMarketRegimeClassification } from "@/src/server/trading-core-s2/market-regime.classifier.service";
import {
  persistMarketRegime,
  persistMomentumBreakoutCandidates,
  getLatestDiscoverySnapshot,
  listMomentumCandidates,
  getLatestMomentumStatistics,
  listMarketRegimeHistory,
  listRejectedDiscoveryScores,
} from "@/src/server/trading-core-s2/trading-core-s2.repository";
import {
  setCachedMarketRegime,
  getCachedDiscoveryTopSymbols,
  getCachedMarketRegime,
} from "@/src/server/trading-core-s2/trading-core-s2.cache";
import { emitTradingCoreS2Event, TRADING_CORE_S2_EVENT } from "@/src/server/trading-core-s2/trading-core-s2.events";
import { runDiscoveryV2Scan } from "@/src/server/trading-core-s2/discovery-v2.engine.service";
import { evaluateMomentumBreakoutBatch } from "@/src/server/trading-core-s2/momentum-breakout-v1.strategy.service";
import { calculateMomentumBreakoutStatistics } from "@/src/server/trading-core-s2/momentum-breakout-v1.statistics.service";
import { enqueueMomentumCandidatesForReplay } from "@/src/server/trading-core-s2/momentum-breakout-v1.replay-bridge.service";
import type { TradingCoreS2JobPayload } from "@/src/server/trading-core-s2/trading-core-s2.types";

export async function runTradingCoreS2Job(payload: TradingCoreS2JobPayload) {
  switch (payload.type) {
    case "REGIME_REFRESH": {
      const classification = await refreshMarketRegimeClassification();
      setCachedMarketRegime(classification);
      const record = await persistMarketRegime(classification);
      emitTradingCoreS2Event(TRADING_CORE_S2_EVENT.REGIME_CLASSIFIED, {
        regime: classification.regime,
        confidence: classification.confidence,
      });
      return { regime: classification, recordId: record.id };
    }
    case "DISCOVERY_SCAN":
      return runDiscoveryV2Scan(payload.limit);
    case "DISCOVERY_RANKING": {
      const latest = await getLatestDiscoverySnapshot();
      return latest ?? { message: "No discovery snapshot available" };
    }
    case "MOMENTUM_EVALUATE": {
      const regime = getCachedMarketRegime();
      const symbols = getCachedDiscoveryTopSymbols().slice(0, payload.limit ?? 20);
      const evaluations = await evaluateMomentumBreakoutBatch(symbols, regime?.regime);
      const latest = await getLatestDiscoverySnapshot();
      const records = await persistMomentumBreakoutCandidates(
        evaluations,
        latest?.id,
        regime?.regime,
      );
      const replayJobs = await enqueueMomentumCandidatesForReplay(evaluations, records, regime?.regime);
      emitTradingCoreS2Event(TRADING_CORE_S2_EVENT.MOMENTUM_EVALUATED, {
        count: records.length,
        buyCandidates: evaluations.filter((e) => e.verdict === "BUY_CANDIDATE").length,
        replayEnqueued: replayJobs.length,
      });
      return { evaluated: evaluations.length, records: records.length, evaluations, replayJobs: replayJobs.length };
    }
    case "STATISTICS_UPDATE":
      return calculateMomentumBreakoutStatistics();
    default:
      return { skipped: true };
  }
}

export async function getTradingCoreS2Dashboard() {
  const discovery = await getLatestDiscoverySnapshot();
  const [regime, momentum, stats, regimeHistory, rejected] = await Promise.all([
    Promise.resolve(getCachedMarketRegime()),
    listMomentumCandidates(30),
    getLatestMomentumStatistics(),
    listMarketRegimeHistory(50),
    discovery ? listRejectedDiscoveryScores(discovery.id, 30) : Promise.resolve([]),
  ]);
  return {
    regime,
    discovery,
    momentum,
    stats,
    regimeHistory,
    rejectedCandidates: rejected,
    topOpportunities: discovery?.candidates ?? [],
  };
}
