"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet } from "@/lib/client-api";
import { Panel } from "@/src/components/common/panel";

type PlatformDashboard = {
  experiments: Array<{
    experimentId: string;
    name: string;
    strategyType: string;
    status: string;
    author: string;
    createdAt: string;
    metrics: Array<{ profitFactor: number | null; sharpe: number | null; winRate: number | null }>;
  }>;
  recommendations: Array<{
    title: string;
    recommendationType: string;
    expectedImprovement: number | null;
    confidence: number | null;
    summary: string | null;
  }>;
  featureResearch: Array<{ featureKey: string; rank: number | null; importance: number | null; status: string }>;
  strategyResearch: Array<{ strategyType: string; rank: number | null; benchmarkScore: number | null; passedValidation: boolean }>;
  counterfactuals: Array<{ scenario: string; alternativeReturnPct: number | null; baselineReturnPct: number | null }>;
  walkForwardResults: Array<{ mode: string; foldIndex: number; passed: boolean }>;
  jobStates: Array<{ jobType: string; status: string; lastProcessedAt: string | null }>;
  sandbox: { isolated: boolean; affectsProduction: boolean };
};

export default function QuantResearchDashboardPage() {
  const [data, setData] = useState<PlatformDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await apiGet<PlatformDashboard>("/api/trading-core/quant-research/platform-dashboard");
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
      <h1 className="text-xl font-semibold">Quant Research Platform — Strategy Lab &amp; Validation</h1>
      <p className="text-xs text-muted-foreground">
        Isolated sandbox — recommendations only, no production impact
        {data?.sandbox?.isolated ? " (verified)" : ""}
      </p>
      {error ? <p className="text-red-400 text-sm">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-4">
        <Panel title="Experiments">
          <p className="text-2xl font-semibold">{data?.experiments?.length ?? 0}</p>
          <p className="text-xs text-muted-foreground">
            Completed: {data?.experiments?.filter((e) => e.status === "COMPLETED").length ?? 0}
          </p>
        </Panel>
        <Panel title="Recommendations">
          <p className="text-2xl font-semibold">{data?.recommendations?.length ?? 0}</p>
          <p className="text-xs text-muted-foreground">Advisory only</p>
        </Panel>
        <Panel title="Walk-Forward Folds">
          <p className="text-2xl font-semibold">{data?.walkForwardResults?.length ?? 0}</p>
          <p className="text-xs text-muted-foreground">
            Passed: {data?.walkForwardResults?.filter((w) => w.passed).length ?? 0}
          </p>
        </Panel>
        <Panel title="Counterfactuals">
          <p className="text-2xl font-semibold">{data?.counterfactuals?.length ?? 0}</p>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Strategy Leaderboard">
          <div className="max-h-48 overflow-auto text-xs space-y-1">
            {(data?.strategyResearch ?? []).slice(0, 15).map((s, i) => (
              <div key={i}>
                #{s.rank ?? "—"} {s.strategyType} score={s.benchmarkScore?.toFixed(2) ?? "—"}{" "}
                {s.passedValidation ? "✓" : "—"}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Feature Leaderboard">
          <div className="max-h-48 overflow-auto text-xs space-y-1">
            {(data?.featureResearch ?? []).slice(0, 15).map((f) => (
              <div key={f.featureKey}>
                #{f.rank ?? "—"} {f.featureKey} imp={f.importance?.toFixed(3) ?? "—"} ({f.status})
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Experiment Timeline">
          <div className="max-h-48 overflow-auto text-xs space-y-1">
            {(data?.experiments ?? []).map((e) => (
              <div key={e.experimentId}>
                {e.experimentId} — {e.strategyType} [{e.status}] PF=
                {e.metrics?.[0]?.profitFactor?.toFixed(2) ?? "—"}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Counterfactual Explorer">
          <div className="max-h-48 overflow-auto text-xs space-y-1">
            {(data?.counterfactuals ?? []).slice(0, 12).map((c, i) => (
              <div key={i}>
                {c.scenario}: baseline={c.baselineReturnPct?.toFixed(2) ?? "—"}% alt=
                {c.alternativeReturnPct?.toFixed(2) ?? "—"}%
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Walk-Forward Results">
          <div className="max-h-48 overflow-auto text-xs space-y-1">
            {(data?.walkForwardResults ?? []).slice(0, 15).map((w, i) => (
              <div key={i}>
                {w.mode} fold {w.foldIndex}: {w.passed ? "PASSED" : "FAILED"}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Recommendations">
          <div className="max-h-48 overflow-auto text-xs space-y-1">
            {(data?.recommendations ?? []).map((r, i) => (
              <div key={i}>
                [{r.recommendationType}] {r.title} — conf={r.confidence?.toFixed(2) ?? "—"}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Research Workers">
          <div className="max-h-48 overflow-auto text-xs space-y-1">
            {(data?.jobStates ?? []).map((j) => (
              <div key={j.jobType}>
                {j.jobType}: {j.status} {j.lastProcessedAt ? new Date(j.lastProcessedAt).toLocaleString() : "—"}
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
