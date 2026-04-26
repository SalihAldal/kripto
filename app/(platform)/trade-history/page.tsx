"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/client-api";
import { ErrorState, SkeletonBlock } from "@/src/components/common/states";
import { TradeHistoryTable } from "@/src/features/trading/components/trade-history-table";
import { NotificationsPanel } from "@/src/features/dashboard/components/notifications-panel";
import { useI18n } from "@/src/i18n/provider";
import type { NotificationItem, TradeHistoryRow } from "@/src/types/platform";

type TradeHistoryApiItem = {
  id: string;
  side: "BUY" | "SELL";
  quantity: number;
  status: string;
  avgExecutionPrice: number | null;
  price: number | null;
  createdAt: string;
  executedAt: string | null;
  updatedAt: string;
  tradingPair: { symbol: string };
  position: {
    side: "LONG" | "SHORT";
    entryPrice: number;
    closePrice: number | null;
    openedAt: string;
    closedAt: string | null;
    realizedPnl: number;
  } | null;
};

export default function TradeHistoryPage() {
  const { t, localeTag } = useI18n();
  const [rows, setRows] = useState<TradeHistoryRow[]>([]);
  const [feed, setFeed] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await apiGet<TradeHistoryApiItem[]>("/api/trades/history");
        const mapped = data.slice(0, 100).map((row): TradeHistoryRow => {
          const entry = row.position?.entryPrice ?? row.avgExecutionPrice ?? row.price ?? 0;
          const exit = row.position?.closePrice ?? row.avgExecutionPrice ?? row.price ?? entry;
          const openedAt = row.position?.openedAt ?? row.createdAt;
          const closedAt = row.position?.closedAt ?? row.executedAt ?? row.updatedAt;
          const durationSec = Math.max(0, Math.round((new Date(closedAt).getTime() - new Date(openedAt).getTime()) / 1000));
          const pnl = row.position?.realizedPnl ?? 0;
          const pnlPercent = entry > 0 ? (pnl / (entry * Math.max(row.quantity, 0.0001))) * 100 : 0;
          return {
            id: row.id,
            time: new Date(row.updatedAt).toLocaleString(localeTag),
            symbol: row.tradingPair.symbol,
            side: row.position?.side ?? (row.side === "BUY" ? "LONG" : "SHORT"),
            entry,
            exit,
            duration: `${durationSec}s`,
            pnlPercent: Number(pnlPercent.toFixed(2)),
            pnl: Number(pnl.toFixed(4)),
          };
        });
        setRows(mapped);
        const logs = await apiGet<Array<{ id: string; level: string; message: string; timestamp: string }>>("/api/logs").catch(() => []);
        setFeed(
          logs.slice(0, 8).map((row) => ({
            id: row.id,
            title: row.level,
            description: row.message,
            level: row.level === "ERROR" || row.level === "CRITICAL" ? "error" : row.level === "WARN" ? "warning" : "info",
            time: new Date(row.timestamp).toLocaleTimeString(localeTag),
          })),
        );
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    };

    void load();
    const timer = setInterval(load, 6000);
    return () => clearInterval(timer);
  }, [localeTag]);

  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-black tracking-tight">{t("tradeHistory.title")}</h1>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-8">
          {loading ? (
            <div className="space-y-2">
              <SkeletonBlock className="h-10" />
              <SkeletonBlock className="h-10" />
              <SkeletonBlock className="h-10" />
            </div>
          ) : error ? (
            <ErrorState message={error} />
          ) : (
            <TradeHistoryTable rows={rows} />
          )}
        </div>
        <div className="xl:col-span-4">
          <NotificationsPanel items={feed} />
        </div>
      </div>
    </div>
  );
}
