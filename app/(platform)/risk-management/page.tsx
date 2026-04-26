"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/client-api";
import { RiskSettingsPanel } from "@/src/features/risk/components/risk-settings-panel";
import { SystemStatusPanel } from "@/src/features/dashboard/components/system-status-panel";
import { NotificationsPanel } from "@/src/features/dashboard/components/notifications-panel";
import { Panel } from "@/src/components/common/panel";
import { PlaceholderChart } from "@/src/components/common/placeholder-chart";
import { useI18n } from "@/src/i18n/provider";
import type { NotificationItem } from "@/src/types/platform";

export default function RiskManagementPage() {
  const { t, localeTag } = useI18n();
  const [pausedState, setPausedState] = useState<{ paused: boolean; pauseReason?: string | null } | null>(null);
  const [riskSnapshot, setRiskSnapshot] = useState<{
    daily?: { netPnl24h?: number; lossAmountAbs?: number };
    weekly?: { netPnl7d?: number; lossAmountAbs?: number };
    effective?: { maxDailyLossPercent?: number; maxWeeklyLossPercent?: number };
  } | null>(null);
  const [feed, setFeed] = useState<NotificationItem[]>([]);

  useEffect(() => {
    const load = async () => {
      const [status, logs] = await Promise.all([
        apiGet<{ paused: boolean; pauseReason?: string | null }>("/api/system/status").catch(() => null),
        apiGet<Array<{ id: string; level: string; message: string; timestamp: string }>>("/api/logs").catch(() => null),
      ]);
      if (status) setPausedState(status);
      // Neden: Risk ekraninda gunluk/haftalik breaker kullanimini canli gostermek operasyonda kritik.
      const risk = await apiGet<{
        daily?: { netPnl24h?: number; lossAmountAbs?: number };
        weekly?: { netPnl7d?: number; lossAmountAbs?: number };
        effective?: { maxDailyLossPercent?: number; maxWeeklyLossPercent?: number };
      }>("/api/risk/status").catch(() => null);
      if (risk) setRiskSnapshot(risk);
      if (logs) {
        setFeed(
          logs.slice(0, 8).map((row) => ({
            id: row.id,
            title: row.level,
            description: row.message,
            level: row.level === "ERROR" || row.level === "CRITICAL" ? "error" : row.level === "WARN" ? "warning" : "info",
            time: new Date(row.timestamp).toLocaleTimeString(localeTag),
          })),
        );
      }
    };
    void load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [localeTag]);

  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-black tracking-tight">{t("riskManagement.title")}</h1>
      {pausedState?.paused ? (
        <div className="rounded-xl border border-tertiary/40 bg-tertiary/10 px-4 py-3 text-sm text-tertiary">
          {t("riskManagement.stopped")} {pausedState.pauseReason ?? t("riskManagement.riskBreakerActive")}
        </div>
      ) : null}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-8 space-y-4">
          <Panel title="Risk Snapshot">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-lg bg-surface-container-low px-3 py-3">
                <p className="text-[11px] uppercase text-on-surface-variant">Gunluk Net PnL</p>
                <p className="text-lg font-black">{Number(riskSnapshot?.daily?.netPnl24h ?? 0).toFixed(2)}</p>
              </div>
              <div className="rounded-lg bg-surface-container-low px-3 py-3">
                <p className="text-[11px] uppercase text-on-surface-variant">Gunluk Zarar</p>
                <p className="text-lg font-black">{Number(riskSnapshot?.daily?.lossAmountAbs ?? 0).toFixed(2)}</p>
              </div>
              <div className="rounded-lg bg-surface-container-low px-3 py-3">
                <p className="text-[11px] uppercase text-on-surface-variant">Haftalik Net PnL</p>
                <p className="text-lg font-black">{Number(riskSnapshot?.weekly?.netPnl7d ?? 0).toFixed(2)}</p>
              </div>
              <div className="rounded-lg bg-surface-container-low px-3 py-3">
                <p className="text-[11px] uppercase text-on-surface-variant">Haftalik Zarar</p>
                <p className="text-lg font-black">{Number(riskSnapshot?.weekly?.lossAmountAbs ?? 0).toFixed(2)}</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-on-surface-variant">
              Daily limit: %{Number(riskSnapshot?.effective?.maxDailyLossPercent ?? 0).toFixed(1)} | Weekly limit: %
              {Number(riskSnapshot?.effective?.maxWeeklyLossPercent ?? 0).toFixed(1)}
            </p>
          </Panel>
          <Panel title={t("riskManagement.exposurePanel")}>
            <PlaceholderChart height={260} />
          </Panel>
          <RiskSettingsPanel />
        </div>
        <div className="xl:col-span-4 space-y-4">
          <SystemStatusPanel />
          <NotificationsPanel items={feed} />
        </div>
      </div>
    </div>
  );
}
