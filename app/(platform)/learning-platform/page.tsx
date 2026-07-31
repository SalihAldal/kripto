"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet } from "@/lib/client-api";
import { Panel } from "@/src/components/common/panel";

type DashboardPayload = {
  datasets: Array<{ datasetId: string; validRowCount: number; status: string; featureVersion: string }>;
  candidates: Array<{ status: string; role: string; profitFactor: number | null; meetsCriteria: boolean; model: { version: string; algorithm: string } }>;
  coinProfiles: Array<{ symbol: string; avgWinRate: number; tradeCount: number; bestMarketRegime: string | null }>;
  marketMemories: Array<{ regimeType: string; winRate: number | null; occurrenceCount: number }>;
  tradeMemories: Array<{ symbol: string; pnlPct: number | null; whyWin: string | null; whyLoss: string | null }>;
  reports: Array<{ reportType: string; summary: string | null; reportDate: string }>;
  promotionCandidates: Array<{ status: string; meetsCriteria: boolean; promotionBlockers: string[] }>;
};

export default function LearningPlatformDashboardPage() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await apiGet<DashboardPayload>("/api/trading-core/learning-platform/dashboard");
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
      <h1 className="text-xl font-semibold">Learning Platform — Datasets, Models &amp; Intelligence</h1>
      {error ? <p className="text-red-400 text-sm">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-4">
        <Panel title="Datasets">
          <p className="text-2xl font-semibold">{data?.datasets?.length ?? 0}</p>
          <p className="text-xs text-muted-foreground">
            Latest: {data?.datasets?.[0]?.validRowCount ?? 0} valid rows ({data?.datasets?.[0]?.status ?? "—"})
          </p>
        </Panel>
        <Panel title="Model Candidates">
          <p className="text-2xl font-semibold">{data?.candidates?.length ?? 0}</p>
          <p className="text-xs text-muted-foreground">
            Eligible: {data?.promotionCandidates?.filter((c) => c.meetsCriteria).length ?? 0}
          </p>
        </Panel>
        <Panel title="Coin Profiles">
          <p className="text-2xl font-semibold">{data?.coinProfiles?.length ?? 0}</p>
        </Panel>
        <Panel title="Market Memories">
          <p className="text-2xl font-semibold">{data?.marketMemories?.length ?? 0}</p>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Dataset Growth">
          <div className="max-h-48 overflow-auto text-xs space-y-1">
            {(data?.datasets ?? []).map((d) => (
              <div key={d.datasetId}>
                {d.datasetId} — {d.validRowCount} rows ({d.status}) v{d.featureVersion}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Training History / Candidates">
          <div className="max-h-48 overflow-auto text-xs space-y-1">
            {(data?.candidates ?? []).map((c, i) => (
              <div key={i}>
                {c.model?.version} {c.model?.algorithm} — {c.status} PF={c.profitFactor?.toFixed(2) ?? "—"}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Coin Intelligence">
          <div className="max-h-48 overflow-auto text-xs space-y-1">
            {(data?.coinProfiles ?? []).slice(0, 15).map((c) => (
              <div key={c.symbol}>
                {c.symbol} WR={c.avgWinRate.toFixed(1)}% trades={c.tradeCount} best={c.bestMarketRegime ?? "—"}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Trade Memory">
          <div className="max-h-48 overflow-auto text-xs space-y-1">
            {(data?.tradeMemories ?? []).slice(0, 10).map((t, i) => (
              <div key={i}>
                {t.symbol} pnl={t.pnlPct?.toFixed(2) ?? "—"}% — {t.whyWin ?? t.whyLoss ?? "—"}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Market Memory">
          <div className="max-h-48 overflow-auto text-xs space-y-1">
            {(data?.marketMemories ?? []).map((m) => (
              <div key={m.regimeType}>
                {m.regimeType} WR={m.winRate?.toFixed(1) ?? "—"}% n={m.occurrenceCount}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Daily Learning Reports">
          <div className="max-h-48 overflow-auto text-xs space-y-1">
            {(data?.reports ?? []).slice(0, 10).map((r) => (
              <div key={r.reportDate}>
                {r.reportType}: {r.summary ?? "—"}
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
