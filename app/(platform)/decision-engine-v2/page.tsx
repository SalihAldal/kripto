"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet } from "@/lib/client-api";
import { Panel } from "@/src/components/common/panel";

type DashboardPayload = {
  activeModel: { id: string; version: string; algorithm: string; status: string } | null;
  registry: {
    champion: { version: string; algorithm: string } | null;
    challenger: { version: string; algorithm: string } | null;
    active: { version: string; algorithm: string } | null;
  };
  promotion: {
    shadowTradeCount: number;
    comparison: {
      winRateDelta: number;
      profitFactorDelta: number;
      expectancyDelta: number;
      maxDrawdownDelta: number;
    };
    promotion: { status: string; rationale: string | null } | null;
  };
  predictions: Array<{
    symbol: string;
    decision: string;
    confidence: number;
    inferenceTimeMs: number;
    predictedAt: string;
  }>;
  featureImportance: Array<{ featureName: string; gainImportance: number | null; shapValue: number | null }>;
  distribution: Array<{ decision: string; _count: { decision: number } }>;
};

export default function DecisionEngineV2DashboardPage() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await apiGet<DashboardPayload>("/api/trading-core/decision-engine-v2/dashboard");
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
      <h1 className="text-xl font-semibold">Decision Engine V2 — ML &amp; Shadow</h1>
      {error ? <p className="text-red-400 text-sm">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Active Model">
          {data?.activeModel ? (
            <div className="space-y-1 text-sm">
              <p>Version: {data.activeModel.version}</p>
              <p>Algorithm: {data.activeModel.algorithm}</p>
              <p>Status: {data.activeModel.status}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No trained model yet.</p>
          )}
        </Panel>

        <Panel title="Model Registry">
          <div className="space-y-1 text-sm">
            <p>Champion: {data?.registry.champion?.version ?? "—"}</p>
            <p>Challenger: {data?.registry.challenger?.version ?? "—"}</p>
            <p>Active: {data?.registry.active?.version ?? "—"}</p>
          </div>
        </Panel>

        <Panel title="Promotion Status">
          <div className="space-y-1 text-sm">
            <p>Shadow trades: {data?.promotion.shadowTradeCount ?? 0}</p>
            <p>Status: {data?.promotion.promotion?.status ?? "PENDING"}</p>
            <p>PF delta: {(data?.promotion.comparison?.profitFactorDelta ?? 0).toFixed(2)}</p>
            <p className="text-muted-foreground text-xs">{data?.promotion.promotion?.rationale ?? ""}</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="A/B: ML vs Rule">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <p>Win rate Δ: {(data?.promotion.comparison?.winRateDelta ?? 0).toFixed(2)}%</p>
            <p>Expectancy Δ: {(data?.promotion.comparison?.expectancyDelta ?? 0).toFixed(4)}</p>
            <p>PF Δ: {(data?.promotion.comparison?.profitFactorDelta ?? 0).toFixed(2)}</p>
            <p>Max DD Δ: {(data?.promotion.comparison?.maxDrawdownDelta ?? 0).toFixed(2)}</p>
          </div>
        </Panel>

        <Panel title="Prediction Distribution">
          <ul className="space-y-1 text-sm">
            {(data?.distribution ?? []).map((row) => (
              <li key={row.decision} className="flex justify-between">
                <span>{row.decision}</span>
                <span>{row._count.decision}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title="Feature Importance">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="p-2">Feature</th>
                <th className="p-2">Gain</th>
                <th className="p-2">SHAP</th>
              </tr>
            </thead>
            <tbody>
              {(data?.featureImportance ?? []).slice(0, 12).map((row) => (
                <tr key={row.featureName} className="border-t border-border/40">
                  <td className="p-2">{row.featureName}</td>
                  <td className="p-2">{(row.gainImportance ?? 0).toFixed(4)}</td>
                  <td className="p-2">{(row.shapValue ?? 0).toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Recent Predictions">
        <ul className="space-y-1 text-sm max-h-64 overflow-y-auto">
          {(data?.predictions ?? []).map((row) => (
            <li key={`${row.symbol}-${row.predictedAt}`} className="flex justify-between gap-2">
              <span>{row.symbol}</span>
              <span className="text-muted-foreground">
                {row.decision} · {row.confidence.toFixed(0)}% · {row.inferenceTimeMs.toFixed(1)}ms
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
