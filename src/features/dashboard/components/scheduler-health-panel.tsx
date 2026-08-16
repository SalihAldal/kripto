"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/client-api";
import { Panel } from "@/src/components/common/panel";
import { useI18n } from "@/src/i18n/provider";

type HealthSnapshot = {
  generatedAt: string;
  overallScore: number;
  schedulerHealth: number;
  runtimeHealth: number;
  recoveryHealth: number;
  watchdogHealth: number;
  scannerHealth: number;
  aiHealth: number;
  databaseHealth: number;
  ownershipHealth: number;
  heartbeatHealth: number;
  leaseHealth: number;
  registryHealth: number;
  watchdog: {
    activeCount: number;
    entries: Array<{ jobId: string; ownerId: string; tickCount: number }>;
  };
  recoveryManager: {
    processOwnerId: string;
    pendingRecoveries: number;
  };
  jobs: Array<{
    jobId: string;
    score: number;
    canRecover: boolean;
    issues: Array<{ component: string; failure: string; severity: string; message: string }>;
    recoveryState: { escalationLevel: number; recoveryCount: number };
  }>;
};

type RecoveryResponse = {
  health: HealthSnapshot;
  recovery: {
    recoveredLoops: number;
    recoveries: Array<{ jobId: string; action: string; result: string }>;
  };
  timeline: Array<{ timestamp: string; action: string; result: string; failure: string; message?: string }>;
};

function scoreClass(score: number) {
  if (score >= 85) return "text-emerald-400";
  if (score >= 60) return "text-amber-400";
  return "text-rose-400";
}

type Props = {
  livePollingEnabled?: boolean;
};

export function SchedulerHealthPanel({ livePollingEnabled = true }: Props) {
  const { t } = useI18n();
  const [data, setData] = useState<RecoveryResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!livePollingEnabled) return;
    const load = async () => {
      const payload = await apiGet<RecoveryResponse>("/api/trades/rounds/recovery").catch(() => null);
      if (payload) setData(payload);
    };
    void load();
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, [livePollingEnabled]);

  const health = data?.health;

  const triggerRecovery = async () => {
    setLoading(true);
    try {
      await apiPost("/api/trades/rounds/recovery", { force: false });
      const payload = await apiGet<RecoveryResponse>("/api/trades/rounds/recovery").catch(() => null);
      if (payload) setData(payload);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Panel title={t("dashboard.schedulerHealth.title", "Scheduler Recovery Health")}>
      {!health ? (
        <p className="text-sm text-zinc-400">{t("dashboard.schedulerHealth.loading", "Loading health snapshot...")}</p>
      ) : (
        <div className="space-y-4 text-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-zinc-500">
                {t("dashboard.schedulerHealth.overall", "Overall Health Score")}
              </div>
              <div className={`text-2xl font-semibold ${scoreClass(health.overallScore)}`}>{health.overallScore}</div>
            </div>
            <button
              type="button"
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-800 disabled:opacity-50"
              disabled={loading}
              onClick={() => void triggerRecovery()}
            >
              {loading
                ? t("dashboard.schedulerHealth.recovering", "Recovering...")
                : t("dashboard.schedulerHealth.recover", "Run Recovery")}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              ["Scheduler", health.schedulerHealth],
              ["Runtime", health.runtimeHealth],
              ["Recovery", health.recoveryHealth],
              ["Watchdog", health.watchdogHealth],
              ["Scanner", health.scannerHealth],
              ["AI", health.aiHealth],
              ["Database", health.databaseHealth],
              ["Registry", health.registryHealth],
            ].map(([label, score]) => (
              <div key={label} className="rounded border border-zinc-800 p-2">
                <div className="text-xs text-zinc-500">{label}</div>
                <div className={`font-medium ${scoreClass(Number(score))}`}>{score}</div>
              </div>
            ))}
          </div>

          <div className="rounded border border-zinc-800 p-3">
            <div className="mb-2 text-xs uppercase tracking-wide text-zinc-500">
              {t("dashboard.schedulerHealth.watchdog", "Watchdog")}
            </div>
            <div className="text-zinc-300">
              {health.watchdog.activeCount} active · owner {health.recoveryManager.processOwnerId}
            </div>
          </div>

          {health.jobs.length > 0 ? (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wide text-zinc-500">
                {t("dashboard.schedulerHealth.jobs", "Running Jobs")}
              </div>
              {health.jobs.map((job) => (
                <div key={job.jobId} className="rounded border border-zinc-800 p-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs">{job.jobId}</span>
                    <span className={scoreClass(job.score)}>{job.score}</span>
                  </div>
                  {job.issues.length > 0 ? (
                    <ul className="mt-1 space-y-1 text-xs text-zinc-400">
                      {job.issues.slice(0, 3).map((issue, index) => (
                        <li key={`${job.jobId}-${index}`}>
                          [{issue.severity}] {issue.component}: {issue.message}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="mt-1 text-xs text-emerald-400">
                      {t("dashboard.schedulerHealth.healthy", "Healthy")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : null}

          {data?.timeline?.length ? (
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wide text-zinc-500">
                {t("dashboard.schedulerHealth.timeline", "Recovery Timeline")}
              </div>
              {data.timeline.slice(0, 5).map((event, index) => (
                <div key={`${event.timestamp}-${index}`} className="text-xs text-zinc-400">
                  {event.timestamp} · {event.action} · {event.result} · {event.failure}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );
}
