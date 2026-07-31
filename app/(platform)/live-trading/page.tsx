"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/client-api";
import { Panel } from "@/src/components/common/panel";

type DashboardPayload = {
  trades: Array<{
    id: string;
    tradeKey: string;
    symbol: string;
    status: string;
    entryPrice: number;
    exitPrice: number | null;
    returnPct: number;
    realizedPnl: number;
    openedAt: string;
    closedAt: string | null;
    quantity: number;
    strategy: string | null;
    marketRegime: string | null;
    modelVersion: string | null;
  }>;
  executions: Array<{
    id: string;
    symbol: string;
    side: string;
    fillPrice: number;
    executedQty: number;
    latencyMs: number | null;
    slippagePct: number;
    executedAt: string;
    audit: { executionResult: string | null; executionConfidence: number | null } | null;
  }>;
  readiness: {
    readinessScore: number;
    status: string;
    recommendation: string | null;
  } | null;
  health: {
    overallScore: number;
    exchangeHealthy: boolean;
    databaseHealthy: boolean;
    workersHealthy: boolean;
    executionLatencyMs: number | null;
    exchangeLatencyMs: number | null;
    recordedAt: string;
  } | null;
  capital: {
    dailyPnl: number;
    dailyTradeCount: number;
    consecutiveLosses: number;
    openPositionCount: number;
    blocked: boolean;
    blockReason: string | null;
  } | null;
  circuitBreakers: Array<{ id: string; reason: string; message: string | null; triggeredAt: string }>;
  killSwitches: Array<{ id: string; source: string; reason: string; triggeredAt: string }>;
  alerts: Array<{ id: string; eventType: string; severity: string; title: string; message: string; createdAt: string }>;
  reports: Array<{ reportDate: string; cadence: string; summary: string | null; tradeCount: number; winRate: number | null }>;
  summary: {
    totalTrades: number;
    openTrades: number;
    closedTrades: number;
    totalPnl: number;
    winRate: number;
  };
  goLive: {
    passed: boolean;
    score: number;
    blockers: string[];
    gates: Record<string, boolean>;
    recommendation: string;
  } | null;
  autoLiveEnabled: boolean;
};

export default function LiveTradingDashboardPage() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await apiGet<DashboardPayload>("/api/trading-core/live-trading/dashboard");
      setData(payload);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const activateKillSwitch = async () => {
    try {
      await apiPost("/api/trading-core/live-trading/kill-switch", {
        action: "activate",
        source: "DASHBOARD",
        reason: "Dashboard manual kill switch",
      });
      setActionMsg("Kill switch activated");
      void load();
    } catch (e) {
      setActionMsg((e as Error).message);
    }
  };

  const goLivePassed = data?.goLive?.passed ?? false;
  const killActive = (data?.killSwitches?.length ?? 0) > 0;
  const breakerActive = (data?.circuitBreakers?.length ?? 0) > 0;

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Live Trading Production Platform</h1>
          <p className="text-xs text-muted-foreground">
            Same pipeline as paper — real Binance orders. Live mode requires manual confirmation
            {data?.autoLiveEnabled === false ? " (gate enforced)" : ""}.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void activateKillSwitch()}
          className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
        >
          Kill Switch
        </button>
      </div>

      {error ? <p className="text-red-400 text-sm">{error}</p> : null}
      {actionMsg ? <p className="text-amber-400 text-sm">{actionMsg}</p> : null}

      <div className="grid gap-4 lg:grid-cols-4">
        <Panel title="Live Readiness">
          <p className="text-2xl font-semibold">{data?.goLive?.score?.toFixed(0) ?? "—"}</p>
          <p className="text-xs text-muted-foreground">{goLivePassed ? "PASSED" : "BLOCKED"}</p>
        </Panel>
        <Panel title="Daily PnL">
          <p className="text-2xl font-semibold">{data?.capital?.dailyPnl?.toFixed(2) ?? "—"}</p>
          <p className="text-xs text-muted-foreground">Trades {data?.capital?.dailyTradeCount ?? 0}</p>
        </Panel>
        <Panel title="Open Positions">
          <p className="text-2xl font-semibold">{data?.summary?.openTrades ?? 0}</p>
          <p className="text-xs text-muted-foreground">Total PnL {data?.summary?.totalPnl?.toFixed(2) ?? "—"}</p>
        </Panel>
        <Panel title="Health Score">
          <p className="text-2xl font-semibold">{data?.health?.overallScore?.toFixed(0) ?? "—"}</p>
          <p className="text-xs text-muted-foreground">
            {data?.health?.exchangeHealthy ? "Exchange OK" : "Exchange DOWN"} ·{" "}
            {data?.health?.databaseHealthy ? "DB OK" : "DB DOWN"}
          </p>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Safety Status">
          <div className="space-y-1 text-xs">
            <p>Circuit Breaker: {breakerActive ? "ACTIVE" : "Clear"}</p>
            <p>Kill Switch: {killActive ? "ACTIVE" : "Clear"}</p>
            <p>Capital Protection: {data?.capital?.blocked ? "BLOCKED" : "Clear"}</p>
            {data?.capital?.blockReason ? <p className="text-red-400">{data.capital.blockReason}</p> : null}
          </div>
        </Panel>
        <Panel title="Go-Live Blockers">
          <div className="max-h-32 overflow-auto text-xs space-y-1">
            {(data?.goLive?.blockers ?? ["—"]).map((b, i) => (
              <div key={i} className="text-red-400">
                {b}
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Paper Readiness">
          <p className="text-sm">{data?.readiness?.status ?? "—"}</p>
          <p className="text-xs text-muted-foreground">Score {data?.readiness?.readinessScore?.toFixed(0) ?? "—"}</p>
          <p className="text-xs">{data?.readiness?.recommendation ?? "—"}</p>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Open Positions">
          <div className="max-h-48 overflow-auto text-xs space-y-1">
            {(data?.trades ?? [])
              .filter((t) => t.status === "OPEN")
              .map((t) => (
                <div key={t.tradeKey}>
                  {t.symbol} entry={t.entryPrice} qty={t.quantity} model={t.modelVersion ?? "—"}
                </div>
              ))}
          </div>
        </Panel>

        <Panel title="Recent Trades">
          <div className="max-h-48 overflow-auto text-xs space-y-1">
            {(data?.trades ?? [])
              .filter((t) => t.status === "CLOSED")
              .slice(0, 15)
              .map((t) => (
                <div key={t.tradeKey}>
                  {t.symbol} {t.returnPct.toFixed(2)}% PnL={t.realizedPnl.toFixed(2)}
                </div>
              ))}
          </div>
        </Panel>

        <Panel title="Execution Audit">
          <div className="max-h-48 overflow-auto text-xs space-y-1">
            {(data?.executions ?? []).slice(0, 15).map((e) => (
              <div key={e.id}>
                {e.side} {e.symbol} @ {e.fillPrice} lat={e.latencyMs ?? "—"}ms slip={e.slippagePct.toFixed(3)}%
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Alerts">
          <div className="max-h-48 overflow-auto text-xs space-y-1">
            {(data?.alerts ?? []).slice(0, 12).map((a) => (
              <div key={a.id}>
                [{a.severity}] {a.title}: {a.message.slice(0, 80)}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Production Reports">
          <div className="max-h-48 overflow-auto text-xs space-y-1">
            {(data?.reports ?? []).map((r) => (
              <div key={`${r.reportDate}-${r.cadence}`}>
                {r.cadence} {r.reportDate}: {r.summary ?? `${r.tradeCount} trades`}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Latency Targets">
          <div className="text-xs space-y-1">
            <p>Execution latency: {data?.health?.executionLatencyMs?.toFixed(0) ?? "—"}ms (target &lt;300ms)</p>
            <p>Exchange latency: {data?.health?.exchangeLatencyMs?.toFixed(0) ?? "—"}ms</p>
            <p>Workers: {data?.health?.workersHealthy ? "Healthy" : "Degraded"}</p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
