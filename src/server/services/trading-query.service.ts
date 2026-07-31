import { listAiDecisionHistory } from "@/src/server/repositories/signal.repository";
import { listSystemLogs } from "@/src/server/repositories/log.repository";
import { getRiskConfigByUser } from "@/src/server/repositories/risk.repository";
import { listOpenPositions } from "@/src/server/repositories/position.repository";
import { listTradeHistory } from "@/src/server/repositories/trade.repository";

export async function getTradingOverview(userId: string) {
  const [history, aiHistory, logs, risk, openPositions] = await Promise.all([
    listTradeHistory({ userId, limit: 50 }),
    listAiDecisionHistory({ userId, limit: 50 }),
    listSystemLogs({ limit: 100 }),
    getRiskConfigByUser(userId),
    listOpenPositions({ userId, limit: 50 }),
  ]);

  return {
    tradeHistory: history,
    aiDecisionHistory: aiHistory,
    systemLogs: logs,
    riskConfig: risk,
    openPositions,
  };
}
