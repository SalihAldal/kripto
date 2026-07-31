import { prisma } from "@/src/server/db/prisma";
import { persistTradeMemory, persistLearningInsight } from "@/src/server/learning-platform/learning-platform.repository";

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function learnTradeMemory(input?: { tradeId?: string; limit?: number }) {
  const trades = input?.tradeId
    ? await prisma.learningTrade.findMany({ where: { id: input.tradeId }, take: 1 })
    : await prisma.learningTrade.findMany({ orderBy: { closedAt: "desc" }, take: input?.limit ?? 50 });

  const memories = [];
  for (const trade of trades) {
    const meta = (trade.metadata as Record<string, unknown> | null) ?? {};
    const pnl = num(trade.returnPercent) ?? 0;
    const holdingMinutes =
      trade.openedAt && trade.closedAt
        ? (trade.closedAt.getTime() - trade.openedAt.getTime()) / 60_000
        : trade.holdSec
          ? trade.holdSec / 60
          : 0;
    const isWin = trade.outcome === "WIN";
    const isLoss = trade.outcome === "LOSS";

    const entryReplay = await prisma.entryReplay.findFirst({
      where: { symbol: trade.symbol },
      orderBy: { replayedAt: "desc" },
    });
    const exitReplay = await prisma.exitReplay.findFirst({
      where: { symbol: trade.symbol },
      orderBy: { replayedAt: "desc" },
    });

    const couldEnterEarlier = entryReplay?.couldEnterEarlier ?? false;
    const couldExitLater = exitReplay?.couldExitLater ?? false;
    const regime = String(trade.marketRegime ?? meta.marketRegime ?? "UNKNOWN");
    const strategy = String(trade.patternKey ?? meta.strategy ?? "unknown");

    const whyWin = isWin
      ? `Momentum and regime ${regime} aligned; return ${pnl.toFixed(2)}% in ${holdingMinutes.toFixed(0)}min`
      : undefined;
    const whyLoss = isLoss
      ? `Adverse move after entry; loss ${pnl.toFixed(2)}% regime=${regime} strategy=${strategy}`
      : undefined;

    const memory = await persistTradeMemory({
      tradeId: trade.id,
      symbol: trade.symbol,
      whyWin,
      whyLoss,
      couldEnterEarlier,
      couldExitLater,
      strategyCorrect: isWin || (!isLoss && pnl >= 0),
      regimeCorrect: isWin,
      pnlPct: pnl,
      holdingMinutes,
      structuredExplanation: {
        questions: {
          whyDidWeWin: whyWin,
          whyDidWeLose: whyLoss,
          couldEnterEarlier,
          couldExitLater,
          wasStrategyCorrect: isWin || pnl >= 0,
          wasRegimeCorrect: isWin,
        },
        trade: {
          outcome: trade.outcome,
          patternKey: trade.patternKey,
          regime,
          entryQuality: meta.entryQuality,
          exitQuality: meta.exitQuality,
        },
      },
      metadata: { source: "learning-platform" },
    });
    memories.push(memory);
  }

  if (memories.length > 0) {
    await persistLearningInsight({
      category: "TRADE",
      title: `Trade memory captured (${memories.length} trades)`,
      content: `Latest: ${memories[0]?.symbol} pnl=${memories[0]?.pnlPct?.toFixed(2)}%`,
    });
  }

  return { captured: memories.length, memories };
}
