"use client";

import { useEffect, useMemo, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { apiGet } from "@/lib/client-api";
import { withBasePath } from "@/lib/base-path";
import type { TradingDashboardSnapshot } from "@/src/server/trading-core/dashboard/dashboard-types";

function formatPnl(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(4)}`;
}

function riskClass(level: string) {
  if (level === "HIGH" || level === "BLOCKED") return "text-tertiary";
  if (level === "MID") return "text-primary";
  return "text-secondary";
}

export default function BotDashboardPage() {
  const [snapshot, setSnapshot] = useState<TradingDashboardSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let socket: Socket | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const loadFallback = async () => {
      try {
        const data = await apiGet<TradingDashboardSnapshot>("/api/trading-core/dashboard");
        if (!cancelled) {
          setSnapshot(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    };

    const init = async () => {
      await fetch(withBasePath("/api/socket/trading-dashboard"));
      socket = io({
        path: withBasePath("/api/socket/trading-dashboard"),
        transports: ["websocket", "polling"],
      });
      socket.on("connect", () => {
        setConnected(true);
        setError(null);
      });
      socket.on("disconnect", () => setConnected(false));
      socket.on("connect_error", () => {
        setConnected(false);
        void loadFallback();
      });
      socket.on("dashboard:snapshot", (data: TradingDashboardSnapshot) => {
        setSnapshot(data);
        setConnected(true);
      });
      pollTimer = setInterval(() => {
        if (!socket?.connected) void loadFallback();
      }, 3000);
      void loadFallback();
    };

    void init();

    return () => {
      cancelled = true;
      socket?.disconnect();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, []);

  const pnlMax = useMemo(() => {
    const values = snapshot?.pnlCurve.map((row) => Math.abs(row.pnl)) ?? [];
    return Math.max(1, ...values);
  }, [snapshot]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Trading Bot Yonetim Dashboardu</h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Socket.IO real-time stream ile botlar, risk, PnL, AI confidence ve market regime izleme paneli.
          </p>
        </div>
        <div className={`rounded-full px-3 py-1 text-xs font-black ${connected ? "bg-secondary/15 text-secondary" : "bg-tertiary/15 text-tertiary"}`}>
          {connected ? "SOCKET.IO BAGLI" : "POLLING FALLBACK"}
        </div>
      </div>

      {error ? <div className="rounded-xl bg-tertiary/15 p-3 text-sm text-tertiary">{error}</div> : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {[
          ["Canli Islem", snapshot?.summary.openTrades ?? 0],
          ["Gunluk PnL", formatPnl(snapshot?.summary.dailyPnl ?? 0)],
          ["Risk", snapshot?.summary.riskLevel ?? "-"],
          ["AI Confidence", `%${(snapshot?.summary.aiConfidence ?? 0).toFixed(2)}`],
          ["Market Regime", snapshot?.summary.marketRegime ?? "-"],
          ["Aktif Bot", snapshot?.summary.activeBots ?? 0],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-surface-container-low p-4">
            <p className="text-xs text-on-surface-variant">{label}</p>
            <p className={`mt-1 text-xl font-black ${label === "Risk" ? riskClass(String(value)) : ""}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section className="rounded-xl bg-surface-container-low p-4 xl:col-span-2">
          <h2 className="text-lg font-black">Canli Islemler</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-on-surface-variant">
                <tr>
                  <th className="py-2">Bot</th>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th>Entry</th>
                  <th>Mark</th>
                  <th>PnL</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(snapshot?.liveTrades ?? []).map((trade) => (
                  <tr key={trade.id} className="border-t border-outline-variant/20">
                    <td className="py-2 font-bold">{trade.botId}</td>
                    <td>{trade.symbol}</td>
                    <td>{trade.side}</td>
                    <td>{trade.entryPrice.toFixed(2)}</td>
                    <td>{trade.markPrice.toFixed(2)}</td>
                    <td className={trade.pnl >= 0 ? "text-secondary" : "text-tertiary"}>{formatPnl(trade.pnl)}</td>
                    <td>{trade.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl bg-surface-container-low p-4">
          <h2 className="text-lg font-black">AI Confidence</h2>
          <div className="mt-3 space-y-3">
            {(snapshot?.aiConfidence ?? []).map((row) => (
              <div key={row.model}>
                <div className="flex justify-between text-xs">
                  <span>{row.model}</span>
                  <span className="font-bold">%{row.confidence.toFixed(2)} · {row.decision}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-surface-container">
                  <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.min(100, row.confidence)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section className="rounded-xl bg-surface-container-low p-4 xl:col-span-2">
          <h2 className="text-lg font-black">PnL Grafigi</h2>
          <div className="mt-4 flex h-48 items-end gap-1 rounded-xl bg-surface-container p-3">
            {(snapshot?.pnlCurve ?? []).map((row) => (
              <div
                key={row.time}
                title={`${new Date(row.time).toLocaleString()} ${row.pnl}`}
                className={`flex-1 rounded-t ${row.pnl >= 0 ? "bg-secondary" : "bg-tertiary"}`}
                style={{ height: `${Math.max(6, (Math.abs(row.pnl) / pnlMax) * 100)}%` }}
              />
            ))}
          </div>
        </section>

        <section className="rounded-xl bg-surface-container-low p-4">
          <h2 className="text-lg font-black">Market Regime</h2>
          <div className="mt-3 space-y-2 text-xs">
            {(snapshot?.marketRegimes ?? []).map((row) => (
              <div key={row.symbol} className="rounded-lg bg-surface-container p-3">
                <div className="flex justify-between font-bold">
                  <span>{row.symbol}</span>
                  <span>%{row.confidence.toFixed(1)}</span>
                </div>
                <p className="mt-1 text-on-surface-variant">{row.regime} · {row.trend}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="rounded-xl bg-surface-container-low p-4">
          <h2 className="text-lg font-black">Bot Performansi</h2>
          <div className="mt-3 space-y-2">
            {(snapshot?.botPerformance ?? []).map((bot) => (
              <div key={bot.botId} className="rounded-lg bg-surface-container p-3 text-xs">
                <div className="flex justify-between font-black">
                  <span>{bot.name}</span>
                  <span>{bot.status}</span>
                </div>
                <p className="mt-1 text-on-surface-variant">
                  Score {bot.score} · Weight {bot.weight} · Winrate %{bot.winrate}
                </p>
                <p className={bot.realizedPnl + bot.unrealizedPnl >= 0 ? "text-secondary" : "text-tertiary"}>
                  PnL {formatPnl(bot.realizedPnl + bot.unrealizedPnl)}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl bg-surface-container-low p-4">
          <h2 className="text-lg font-black">Trade History</h2>
          <div className="mt-3 space-y-2 text-xs">
            {(snapshot?.tradeHistory ?? []).map((trade) => (
              <div key={trade.id} className="grid grid-cols-5 gap-2 rounded-lg bg-surface-container p-2">
                <span className="font-bold">{trade.symbol}</span>
                <span>{trade.side}</span>
                <span className={trade.pnl >= 0 ? "text-secondary" : "text-tertiary"}>{formatPnl(trade.pnl)}</span>
                <span>%{trade.confidence.toFixed(1)}</span>
                <span className="truncate text-on-surface-variant">{trade.marketRegime}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <p className="text-xs text-on-surface-variant">Son guncelleme: {snapshot ? new Date(snapshot.updatedAt).toLocaleString() : "-"}</p>
    </div>
  );
}
