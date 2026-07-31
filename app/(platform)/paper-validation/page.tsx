"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet } from "@/lib/client-api";
import { Panel } from "@/src/components/common/panel";

type DashboardPayload = {
  portfolios: Array<{
    userId: string;
    balance: number;
    availableBalance: number;
    lockedBalance: number;
    totalPnl: number;
    positionCount: number;
  }>;
  trades: Array<{
    tradeKey: string;
    symbol: string;
    status: string;
    returnPct: number;
    overallScore: number | null;
    openedAt: string;
  }>;
  reports: Array<{ reportDate: string; tradeCount: number; winRate: number | null; profitFactor: number | null; summary: string | null }>;
  coinPerformance: Array<{ symbol: string; winRate: number | null; profitFactor: number | null; tradeCount: number }>;
  sessionPerformance: Array<{ sessionType: string; marketRegime: string | null; winRate: number | null; profitFactor: number | null }>;
  readiness: Array<{ readinessScore: number; status: string; recommendation: string | null; reportDate: string }>;
  missedOpportunities: Array<{ category: string; symbol: string; potentialReturnPct: number | null }>;
  summary: { totalTrades: number; winRate: number; totalPnl: number; avgQualityScore: number };
  sandbox: { isolated: boolean; autoLiveEnabled: boolean };
};

export default function PaperValidationDashboardPage() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await apiGet<DashboardPayload>("/api/trading-core/paper-validation/dashboard");
      setData(payload);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-xl font-semibold">Paper Trading Validation Platform</h1>
      <p className="text-xs text-muted-foreground">
        Same pipeline as live — virtual orders only. Live mode requires manual confirmation
        {data?.sandbox?.autoLiveEnabled === false ? " (gate enforced)" : ""}.
      </p>
      {error ? <p className="text-red-400 text-sm">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-4">
        <Panel title="Paper Trades">
          <p className="text-2xl font-semibold">{data?.summary?.totalTrades ?? 0}</p>
          <p className="text-xs text-muted-foreground">WR {data?.summary?.winRate?.toFixed(1) ?? "—"}%</p>
        </Panel>
        <Panel title="Total PnL">
          <p className="text-2xl font-semibold">{data?.summary?.totalPnl?.toFixed(2) ?? "—"}</p>
        </Panel>
        <Panel title="Avg Quality">
          <p className="text-2xl font-semibold">{data?.summary?.avgQualityScore?.toFixed(1) ?? "—"}</p>
        </Panel>
        <Panel title="Readiness">
          <p className="text-2xl font-semibold">{data?.readiness?.[0]?.readinessScore?.toFixed(0) ?? "—"}</p>
          <p className="text-xs text-muted-foreground">{data?.readiness?.[0]?.status ?? "—"}</p>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Portfolio">
          <div className="max-h-48 overflow-auto text-xs space-y-1">
            {(data?.portfolios ?? []).map((p) => (
              <div key={p.userId}>
                {p.userId.slice(0, 8)}… bal={p.balance.toFixed(0)} avail={p.availableBalance.toFixed(0)} locked=
                {p.lockedBalance.toFixed(0)} PnL={p.totalPnl.toFixed(2)} pos={p.positionCount}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Recent Trades">
          <div className="max-h-48 overflow-auto text-xs space-y-1">
            {(data?.trades ?? []).slice(0, 15).map((t) => (
              <div key={t.tradeKey}>
                {t.symbol} [{t.status}] {t.returnPct.toFixed(2)}% score={t.overallScore?.toFixed(0) ?? "—"}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Coin Leaderboard">
          <div className="max-h-48 overflow-auto text-xs space-y-1">
            {(data?.coinPerformance ?? []).slice(0, 15).map((c) => (
              <div key={c.symbol}>
                {c.symbol} WR={c.winRate?.toFixed(1) ?? "—"}% PF={c.profitFactor?.toFixed(2) ?? "—"} n={c.tradeCount}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Session / Regime Leaderboard">
          <div className="max-h-48 overflow-auto text-xs space-y-1">
            {(data?.sessionPerformance ?? []).slice(0, 15).map((s, i) => (
              <div key={i}>
                {s.sessionType} {s.marketRegime ?? ""} PF={s.profitFactor?.toFixed(2) ?? "—"} WR=
                {s.winRate?.toFixed(1) ?? "—"}%
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Daily Reports">
          <div className="max-h-48 overflow-auto text-xs space-y-1">
            {(data?.reports ?? []).map((r) => (
              <div key={r.reportDate}>
                {r.reportDate}: {r.summary ?? `${r.tradeCount} trades`}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Live Readiness">
          <div className="max-h-48 overflow-auto text-xs space-y-1">
            {(data?.readiness ?? []).map((r) => (
              <div key={r.reportDate}>
                {r.reportDate}: score={r.readinessScore} [{r.status}] — {r.recommendation ?? "—"}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Missed Opportunities">
          <div className="max-h-48 overflow-auto text-xs space-y-1">
            {(data?.missedOpportunities ?? []).slice(0, 12).map((m, i) => (
              <div key={i}>
                [{m.category}] {m.symbol} potential={m.potentialReturnPct?.toFixed(2) ?? "—"}%
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Performance Timeline">
          <div className="max-h-48 overflow-auto text-xs space-y-1">
            {(data?.trades ?? [])
              .filter((t) => t.status === "CLOSED")
              .slice(0, 15)
              .map((t) => (
                <div key={t.tradeKey}>
                  {new Date(t.openedAt).toLocaleDateString()} {t.symbol} {t.returnPct.toFixed(2)}%
                </div>
              ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
