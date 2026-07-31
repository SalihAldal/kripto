import { detectWhaleActivity } from "@/src/server/whale-intelligence/whale-detection.service";
import { monitorWallets } from "@/src/server/whale-intelligence/wallet-intelligence.service";
import { calculateFlowIntelligence } from "@/src/server/whale-intelligence/flow-intelligence.service";
import { monitorExchangeFlows } from "@/src/server/whale-intelligence/exchange-flow.service";
import { monitorStablecoinFlows } from "@/src/server/whale-intelligence/stablecoin-flow.service";
import { scoreWhaleActivity, scoreRecentWhales } from "@/src/server/whale-intelligence/whale-score.service";
import { detectLiquidityRotations } from "@/src/server/whale-intelligence/liquidity-movement.service";
import { detectSmartMoneyPatterns } from "@/src/server/whale-intelligence/smart-money-pattern.service";
import { replayWhaleEvent, replayRecentTransactions } from "@/src/server/whale-intelligence/whale-replay.service";
import { learnFromWhaleHistory } from "@/src/server/whale-intelligence/institutional-learning.service";
import { generateWhaleAlerts, deactivateStaleAlerts } from "@/src/server/whale-intelligence/whale-alert.service";
import type { WhaleIntelligenceJobPayload } from "@/src/server/whale-intelligence/whale-intelligence.types";

export async function runWhaleIntelligenceJob(payload: WhaleIntelligenceJobPayload) {
  switch (payload.type) {
    case "WHALE_DETECT":
      return detectWhaleActivity(payload.limit);
    case "WALLET_MONITOR":
      return monitorWallets(payload.limit);
    case "EXCHANGE_FLOW":
      return monitorExchangeFlows(payload.exchange, payload.limit);
    case "STABLECOIN_FLOW":
      return monitorStablecoinFlows(payload.limit);
    case "FLOW_CALCULATE":
      return calculateFlowIntelligence(payload.limit);
    case "WHALE_SCORE":
      return payload.walletId ? scoreWhaleActivity(payload.walletId) : scoreRecentWhales(payload.limit);
    case "LIQUIDITY_ROTATION":
      return detectLiquidityRotations(payload.limit);
    case "PATTERN_DETECT":
      return detectSmartMoneyPatterns(payload.limit);
    case "REPLAY_ANALYZE":
      return payload.transactionId ? replayWhaleEvent(payload.transactionId) : replayRecentTransactions(payload.limit);
    case "INSTITUTIONAL_LEARN":
      return learnFromWhaleHistory(payload.limit);
    case "ALERT_GENERATE":
      await deactivateStaleAlerts();
      return generateWhaleAlerts(payload.limit);
    default:
      return { skipped: true };
  }
}
