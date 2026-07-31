"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet } from "@/lib/client-api";
import { Panel } from "@/src/components/common/panel";

type DashboardPayload = {
  logs: Array<{
    logKey: string;
    symbol: string;
    side: string;
    orderType: string;
    mode: string;
    status: string;
    slippagePct: number | null;
    latencyMs: number | null;
    submittedAt: string;
  }>;
  reconciliations: Array<{ symbol: string; status: string; mismatchReason: string | null }>;
  audits: Array<{ symbol: string; reportType: string; passed: boolean; auditedAt: string }>;
  failures: Array<{ symbol: string; side: string; reason: string; failedAt: string }>;
  openPositions: Array<{ id: string; symbol: string; quantity: number; status: string }>;
  openExitScan: { analyzed?: number; results?: Array<{ verdict?: { verdict?: string }; analysis?: { symbol?: string } }> } | null;
};

export default function ExecutionEngineV2DashboardPage() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await apiGet<DashboardPayload>("/api/trading-core/execution-engine-v2/dashboard");
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

  const avgSlippage =
    data?.logs && data.logs.length > 0
      ? data.logs.reduce((sum, l) => sum + (l.slippagePct ?? 0), 0) / data.logs.length
      : 0;

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-xl font-semibold">Execution Engine V2 — Entry / Exit / Execution</h1>
      {error ? <p className="text-red-400 text-sm">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-4">
        <Panel title="Open Positions">
          <p className="text-2xl font-semibold">{data?.openPositions?.length ?? 0}</p>
        </Panel>
        <Panel title="Recent Executions">
          <p className="text-2xl font-semibold">{data?.logs?.length ?? 0}</p>
        </Panel>
        <Panel title="Avg Slippage %">
          <p className="text-2xl font-semibold">{avgSlippage.toFixed(3)}</p>
        </Panel>
        <Panel title="Reconciliation Mismatches">
          <p className="text-2xl font-semibold">
            {data?.reconciliations?.filter((r) => r.status === "MISMATCH").length ?? 0}
          </p>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Execution Log">
          <div className="max-h-72 overflow-auto text-xs space-y-1">
            {(data?.logs ?? []).map((log) => (
              <div key={log.logKey} className="border-b border-border/40 pb-1">
                {log.symbol} {log.side} {log.status} slippage={log.slippagePct?.toFixed(3) ?? "—"}% latency=
                {log.latencyMs?.toFixed(0) ?? "—"}ms
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Exit AI Scan">
          <div className="max-h-72 overflow-auto text-xs space-y-1">
            {(data?.openExitScan?.results ?? []).slice(0, 15).map((row, idx) => (
              <div key={idx} className="border-b border-border/40 pb-1">
                {row.analysis?.symbol ?? "—"} verdict={row.verdict?.verdict ?? "—"}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Execution Audit">
          <div className="max-h-48 overflow-auto text-xs space-y-1">
            {(data?.audits ?? []).slice(0, 10).map((a) => (
              <div key={a.auditedAt + a.symbol}>
                {a.symbol} {a.reportType} {a.passed ? "PASS" : "FAIL"}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Execution Failures">
          <div className="max-h-48 overflow-auto text-xs space-y-1">
            {(data?.failures ?? []).slice(0, 10).map((f) => (
              <div key={f.failedAt + f.symbol}>
                {f.symbol} {f.side}: {f.reason}
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
