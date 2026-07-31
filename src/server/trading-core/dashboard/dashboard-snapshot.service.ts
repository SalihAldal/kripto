import type { TradingDashboardSnapshot } from "@/src/server/trading-core/dashboard/dashboard-types";

function round(value: number, digits = 4) {
  return Number(value.toFixed(digits));
}

export class TradingDashboardSnapshotService {
  snapshot(): TradingDashboardSnapshot {
    const now = Date.now();
    const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
    const liveTrades = symbols.map((symbol, index) => {
      const entry = 1000 + index * 320 + Math.sin(now / 50_000 + index) * 25;
      const mark = entry * (1 + Math.sin(now / 35_000 + index) * 0.008);
      const quantity = [0.02, 0.4, 3][index] ?? 1;
      const pnl = (mark - entry) * quantity;
      return {
        id: `live-${symbol}`,
        botId: index === 0 ? "trend-bot" : index === 1 ? "scalping-bot" : "breakout-volume-bot",
        symbol,
        side: (index % 2 === 0 ? "BUY" : "SELL") as "BUY" | "SELL",
        entryPrice: round(entry, 2),
        markPrice: round(mark, 2),
        quantity,
        pnl: round(pnl, 4),
        pnlPercent: round(((mark - entry) / entry) * 100, 3),
        status: "OPEN" as const,
        openedAt: new Date(now - (index + 1) * 18 * 60_000).toISOString(),
      };
    });
    const dailyPnl = round(liveTrades.reduce((sum, trade) => sum + trade.pnl, 0), 4);
    const aiConfidenceBase = 72 + Math.sin(now / 25_000) * 9;

    return {
      connected: true,
      updatedAt: new Date(now).toISOString(),
      summary: {
        openTrades: liveTrades.length,
        dailyPnl,
        riskLevel: Math.abs(dailyPnl) > 18 ? "HIGH" : Math.abs(dailyPnl) > 7 ? "MID" : "LOW",
        aiConfidence: round(aiConfidenceBase, 2),
        marketRegime: dailyPnl >= 0 ? "TRENDING_BULLISH" : "SIDEWAYS",
        activeBots: 3,
      },
      liveTrades,
      botPerformance: [
        { botId: "trend-bot", name: "Trend Bot", status: "ACTIVE", score: 82, weight: 1.34, trades: 42, winrate: 61.9, realizedPnl: 128.4, unrealizedPnl: liveTrades[0]?.pnl ?? 0 },
        { botId: "scalping-bot", name: "Scalping Bot", status: "ACTIVE", score: 74, weight: 1.08, trades: 88, winrate: 57.2, realizedPnl: 84.1, unrealizedPnl: liveTrades[1]?.pnl ?? 0 },
        { botId: "breakout-volume-bot", name: "Breakout Volume Bot", status: "ACTIVE", score: 69, weight: 0.92, trades: 25, winrate: 52.0, realizedPnl: 36.8, unrealizedPnl: liveTrades[2]?.pnl ?? 0 },
      ],
      pnlCurve: Array.from({ length: 24 }).map((_, index) => ({
        time: new Date(now - (23 - index) * 60 * 60_000).toISOString(),
        pnl: round(Math.sin(index / 3) * 18 + index * 1.7 + dailyPnl, 3),
      })),
      aiConfidence: [
        { model: "Market Analysis ML", confidence: round(aiConfidenceBase, 2), decision: aiConfidenceBase > 70 ? "BUY" : "HOLD" },
        { model: "Risk AI", confidence: round(68 + Math.cos(now / 30_000) * 7, 2), decision: "LOW_RISK" },
        { model: "Consensus", confidence: round(75 + Math.sin(now / 42_000) * 6, 2), decision: "APPROVED" },
      ],
      marketRegimes: [
        { symbol: "BTCUSDT", regime: "TRENDING_BULLISH", confidence: 82, trend: "BULLISH" },
        { symbol: "ETHUSDT", regime: "SIDEWAYS", confidence: 66, trend: "SIDEWAYS" },
        { symbol: "SOLUSDT", regime: "HIGH_VOLATILITY", confidence: 71, trend: "BULLISH" },
      ],
      tradeHistory: Array.from({ length: 8 }).map((_, index) => ({
        id: `hist-${index}`,
        symbol: symbols[index % symbols.length] ?? "BTCUSDT",
        side: index % 2 === 0 ? "BUY" : "SELL",
        pnl: round(Math.sin(index + now / 100_000) * 14, 3),
        confidence: round(58 + ((index * 7) % 35), 2),
        marketRegime: index % 3 === 0 ? "TRENDING_BULLISH" : index % 3 === 1 ? "SIDEWAYS" : "HIGH_VOLATILITY",
        closedAt: new Date(now - index * 42 * 60_000).toISOString(),
      })),
    };
  }
}

export const tradingDashboardSnapshotService = new TradingDashboardSnapshotService();
