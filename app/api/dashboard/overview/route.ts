import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest, enforceRateLimit } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { ensureTradeMonitors, ensureTradeRoundRecovery } from "@/services/trading-engine.service";
import { listExecutionEvents, listPersistedExecutionEvents } from "@/src/server/execution/execution-event-bus";
import { getRuntimeExecutionContext } from "@/src/server/repositories/execution.repository";
import { listSystemLogs } from "@/src/server/repositories/log.repository";
import { listAiDecisionHistory } from "@/src/server/repositories/signal.repository";
import { listTradeHistory } from "@/src/server/repositories/trade.repository";
import { getRiskStatus } from "@/src/server/risk";

export async function GET(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";

  try {
    const limited = enforceRateLimit(request);
    if (limited) return limited;

    const { user } = await getRuntimeExecutionContext();
    await ensureTradeMonitors(user.id).catch(() => null);
    await ensureTradeRoundRecovery().catch(() => null);
    const [history, aiSignals, riskStatus, systemLogs] = await Promise.all([
      listTradeHistory({ userId: user.id, limit: 60 }),
      listAiDecisionHistory({ userId: user.id, limit: 12 }),
      getRiskStatus(user.id),
      listSystemLogs({ limit: 30 }),
    ]);

    const openPositions = history.filter((x) => x.position?.status === "OPEN").length;
    const closedPositions = history.filter((x) => x.position?.status === "CLOSED").length;
    const pnl24h = riskStatus.daily.netPnl24h;

    const summary = [
    {
      key: "system",
      label: tr ? "Sistem Durumu" : "System Status",
      value: riskStatus.paused.paused ? "PAUSED" : "OPERATIONAL",
      tone: riskStatus.paused.paused ? "tertiary" : "secondary",
      delta: riskStatus.paused.reason ?? (tr ? "Risk koruma aktif" : "Risk guard active"),
    },
    {
      key: "models",
      label: tr ? "AI Sinyal Kayitlari" : "AI Signal Records",
      value: `${aiSignals.length}`,
      tone: "primary",
      delta: tr
        ? "Panelde gosterilen son 12 karar (tarama adedi degil)"
        : "Last 12 decisions shown in panel (not scan count)",
    },
    {
      key: "open",
      label: tr ? "Acik Pozisyonlar" : "Open Positions",
      value: `${openPositions}`,
      tone: openPositions > 0 ? "primary" : "secondary",
      delta: tr ? `Kapanan: ${closedPositions}` : `Closed: ${closedPositions}`,
    },
    {
      key: "pnl",
      label: tr ? "Net PnL (24s)" : "Net PnL (24h)",
      value: `${pnl24h >= 0 ? "+" : ""}${pnl24h.toFixed(2)} USDT`,
      tone: pnl24h >= 0 ? "secondary" : "tertiary",
      delta: tr ? `Zarar adedi: ${riskStatus.daily.lossCount}` : `Loss count: ${riskStatus.daily.lossCount}`,
    },
  ];

    const aiCards = aiSignals.slice(0, 3).map((row) => ({
    id: row.id,
    model: row.aiModelConfig?.displayName ?? row.aiProvider?.name ?? row.source,
    signal: row.side,
    confidence: row.confidence,
    reason: row.reason ?? (tr ? "Neden belirtilmedi" : "No reason"),
  }));

    const notifications = systemLogs.slice(0, 8).map((row) => ({
    id: row.id,
    title: row.source.toUpperCase(),
    description: row.message,
    level: row.level === "ERROR" || row.level === "CRITICAL" ? "error" : row.level === "WARN" ? "warning" : "info",
    time: row.createdAt.toISOString(),
  }));

    const resolveOrderQty = (order: (typeof history)[number]) => {
      const executedQty =
        order.executions
          ?.map((row) => Number(row.executedQty ?? 0))
          .find((qty) => Number.isFinite(qty) && qty > 0) ?? 0;
      return executedQty > 0 ? executedQty : order.quantity;
    };
    const activePositionFilled = history.find(
      (x) => x.status === "FILLED" && x.side === "BUY" && x.position?.status === "OPEN",
    );
    const lastFilled = activePositionFilled ?? history.find((x) => x.status === "FILLED" && Boolean(x.positionId));
    const lastExecutionEvent =
      (await listPersistedExecutionEvents({ limit: 1 }).catch(() => []))[0] ??
      listExecutionEvents(1)[0] ??
      null;
    return apiOkFromRequest(request, {
      summary,
      aiCards,
      notifications,
      lastTrade: lastFilled
        ? {
            orderId: lastFilled.id,
            symbol: lastFilled.tradingPair.symbol,
            side: lastFilled.side,
            status: lastFilled.status,
            avgExecutionPrice: lastFilled.avgExecutionPrice ?? lastFilled.price ?? 0,
            quantity: resolveOrderQty(lastFilled),
            updatedAt: lastFilled.updatedAt.toISOString(),
          }
        : null,
      lastExecutionEvent,
      riskPaused: riskStatus.paused,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
