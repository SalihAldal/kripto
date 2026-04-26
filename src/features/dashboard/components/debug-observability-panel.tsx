"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/client-api";
import { Panel } from "@/src/components/common/panel";
import type { DashboardDebugSnapshot } from "@/src/types/platform";

type Props = {
  symbol: string;
  livePollingEnabled?: boolean;
};

const DASHBOARD_PASSIVE_MODE = process.env.NEXT_PUBLIC_DASHBOARD_PASSIVE_MODE === "true";

function tone(ok: boolean) {
  return ok ? "text-secondary" : "text-tertiary";
}

export function DebugObservabilityPanel({ symbol, livePollingEnabled = true }: Props) {
  const [data, setData] = useState<DashboardDebugSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!symbol) return;
    if (DASHBOARD_PASSIVE_MODE || !livePollingEnabled) return;

    let mounted = true;
    const load = async () => {
      setLoading(true);
      try {
        const row = await apiGet<DashboardDebugSnapshot>(
          `/api/dashboard/debug?symbol=${encodeURIComponent(symbol)}`,
        );
        if (!mounted) return;
        setData(row);
        setError(null);
      } catch (e) {
        if (!mounted) return;
        setError((e as Error).message);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();
    const timer = setInterval(load, 10_000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [livePollingEnabled, symbol]);

  return (
    <Panel title="Debug Observability">
      {error ? <p className="text-xs text-tertiary mb-2">{error}</p> : null}
      {loading && !data ? <p className="text-xs text-on-surface-variant mb-2">Yukleniyor...</p> : null}
      {!data ? null : (
        <div className="space-y-3 text-xs">
          <div className="rounded-md bg-surface-container-low p-2">
            <p className="font-bold mb-1">Scanner</p>
            <p>symbol: {data.symbol}</p>
            <p>scanned: {data.scanner.scannedCount} | qualified: {data.scanner.qualifiedCount} | ai: {data.scanner.aiEvaluatedCount}</p>
            <p className={tone(Boolean(data.scanner.context?.tradable))}>
              tradable: {String(Boolean(data.scanner.context?.tradable))}
            </p>
            {data.scanner.context?.rejectReasons?.length ? (
              <p className="text-tertiary">reject: {data.scanner.context.rejectReasons.join(" | ")}</p>
            ) : null}
          </div>

          <div className="rounded-md bg-surface-container-low p-2">
            <p className="font-bold mb-1">AI</p>
            <p>decision: {data.ai.finalDecision ?? "-"}</p>
            <p>confidence: {data.ai.finalConfidence ?? "-"} | risk: {data.ai.finalRiskScore ?? "-"}</p>
            <div className="mt-1 space-y-1">
              {data.ai.providers.map((row) => (
                <div key={row.providerId} className="rounded bg-surface-container px-2 py-1">
                  <p className="font-semibold">{row.providerName}</p>
                  <p className={tone(row.ok)}>
                    ok={String(row.ok)} remote={String(row.remote)} latency={row.latencyMs}ms decision={row.decision ?? "-"}
                  </p>
                  {row.error ? <p className="text-tertiary">{row.error}</p> : null}
                </div>
              ))}
            </div>
            <div className="mt-2 rounded bg-surface-container px-2 py-2">
              <p className="font-semibold mb-1">Lane Bazli Provider</p>
              {(["technical", "momentum", "risk"] as const).map((lane) => {
                const providerId = data.ai.laneProviderMap?.[lane];
                const provider = data.ai.providers.find((x) => x.providerId === providerId);
                return (
                  <p key={lane} className={tone(Boolean(provider?.ok))}>
                    {lane}: {providerId ?? "-"} | remote={String(Boolean(provider?.remote))} | latency=
                    {provider?.latencyMs ?? "-"}ms | decision={provider?.decision ?? "-"}
                  </p>
                );
              })}
            </div>
          </div>

          <div className="rounded-md bg-surface-container-low p-2">
            <p className="font-bold mb-1">Execution</p>
            <p>latestExecutionId: {data.execution.latestExecutionId ?? "-"}</p>
            <p>openPositions: {data.execution.openPositions ?? "-"}</p>
            <p>maxOpenPositions(log): {data.execution.maxOpenPositions ?? "-"}</p>
            <div className="mt-1 max-h-28 overflow-auto space-y-1">
              {data.execution.stages.map((row, idx) => (
                <p key={`${row.stage}-${row.createdAt}-${idx}`} className="rounded bg-surface-container px-2 py-1">
                  [{row.status}] {row.stage} - {row.message}
                </p>
              ))}
            </div>
          </div>

          <div className="rounded-md bg-surface-container-low p-2">
            <p className="font-bold mb-1">Exchange</p>
            <p className={tone(!data.exchange.fallbackActive)}>
              fallbackActive={String(data.exchange.fallbackActive)} globalBan={String(data.exchange.globalBanActive)} networkCooldown={String(data.exchange.networkCooldownActive)}
            </p>
            <div className="mt-1 max-h-28 overflow-auto space-y-1">
              {data.exchange.endpointHealth.map((row) => (
                <p key={row.base} className="rounded bg-surface-container px-2 py-1">
                  {row.base} | score={row.score} ok={row.successes}/{row.totalCalls} fail={row.failures} latency={row.latencyEwmaMs}ms
                </p>
              ))}
            </div>
          </div>

          <div className="rounded-md bg-surface-container-low p-2">
            <p className="font-bold mb-1">Recent Symbol Logs</p>
            <div className="max-h-32 overflow-auto space-y-1">
              {data.recentLogs.map((row, idx) => (
                <p key={`${row.timestamp}-${idx}`} className="rounded bg-surface-container px-2 py-1">
                  [{row.level}] {row.message}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
