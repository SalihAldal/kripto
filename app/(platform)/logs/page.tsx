"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/client-api";
import type { SystemLog } from "@/lib/types";
import { Panel } from "@/src/components/common/panel";
import { SystemStatusPanel } from "@/src/features/dashboard/components/system-status-panel";
import { ErrorState, SkeletonBlock } from "@/src/components/common/states";
import { useI18n } from "@/src/i18n/provider";

export default function LogsPage() {
  const { t, localeTag } = useI18n();
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [actionType, setActionType] = useState("");
  const [status, setStatus] = useState("");
  const [symbol, setSymbol] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => {
      const params = new URLSearchParams();
      if (actionType) params.set("actionType", actionType);
      if (status) params.set("status", status);
      if (symbol) params.set("symbol", symbol);
      if (showErrors) params.set("hasError", "1");
      params.set("limit", "250");
      apiGet<SystemLog[]>(`/api/logs?${params.toString()}`)
        .then((data) => {
          setLogs(data);
          setError(null);
        })
        .catch((err: Error) => setError(err.message))
        .finally(() => setLoading(false));
    };
    load();
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  }, [actionType, status, symbol, showErrors]);

  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-black tracking-tight">{t("logs.title")}</h1>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-8">
          <div className="mb-3 grid grid-cols-1 md:grid-cols-4 gap-2">
            <input
              value={actionType}
              onChange={(e) => setActionType(e.target.value)}
              placeholder="actionType"
              className="rounded-md bg-surface-container px-3 py-2 text-xs outline-none"
            />
            <input
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              placeholder="status"
              className="rounded-md bg-surface-container px-3 py-2 text-xs outline-none"
            />
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="symbol"
              className="rounded-md bg-surface-container px-3 py-2 text-xs outline-none"
            />
            <label className="rounded-md bg-surface-container px-3 py-2 text-xs flex items-center justify-between gap-2">
              <span>Hatalar</span>
              <input type="checkbox" checked={showErrors} onChange={(e) => setShowErrors(e.target.checked)} />
            </label>
          </div>
          <Panel title={t("logs.stream")}>
            <div className="h-[65vh] overflow-y-auto scroll-slim font-mono text-xs space-y-2">
              {loading ? (
                <div className="space-y-2">
                  <SkeletonBlock className="h-8" />
                  <SkeletonBlock className="h-8" />
                  <SkeletonBlock className="h-8" />
                </div>
              ) : error ? (
                <ErrorState message={error} />
              ) : logs.length === 0 ? (
                <p className="text-on-surface-variant">{t("logs.notFound")}</p>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="flex gap-3 border-b border-outline-variant/10 pb-2">
                    <span className="text-on-surface-variant">{new Date(log.timestamp).toLocaleTimeString(localeTag)}</span>
                    <span
                      className={
                        log.level === "ERROR"
                          ? "text-tertiary"
                          : log.level === "TRADE"
                            ? "text-primary"
                            : log.level === "SIGNAL"
                              ? "text-secondary"
                              : "text-on-surface"
                      }
                    >
                      [{log.level}]
                    </span>
                    <span>{log.message}</span>
                    {log.context ? (
                      <span className="text-on-surface-variant break-all">
                        {JSON.stringify(log.context)}
                      </span>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </Panel>
        </div>
        <div className="xl:col-span-4">
          <SystemStatusPanel />
        </div>
      </div>
    </div>
  );
}
