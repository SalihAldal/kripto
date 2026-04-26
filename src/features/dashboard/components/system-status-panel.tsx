 "use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/client-api";
import { Panel } from "@/src/components/common/panel";
import { useI18n } from "@/src/i18n/provider";

type SystemStatus = {
  status: "OPERATIONAL" | "PAUSED";
  paused: boolean;
  pauseReason?: string | null;
  openTrades: number;
  totalPnl: number;
  consecutiveLosses: number;
  riskGuard: string;
};

type ExchangeAuthCheck = {
  ok: boolean;
  reason: string;
  hint?: string;
  actions?: string[];
  accountRead?: {
    code: string | null;
    message: string | null;
  };
  tradePermission?: {
    code: string | null;
    message: string | null;
  };
};

const DASHBOARD_PASSIVE_MODE = process.env.NEXT_PUBLIC_DASHBOARD_PASSIVE_MODE !== "false";

function hasAuthPermissionError(data: ExchangeAuthCheck | null) {
  if (!data || data.ok) return false;
  const codes = [data.accountRead?.code, data.tradePermission?.code].filter(Boolean);
  const messages = [data.accountRead?.message, data.tradePermission?.message, data.reason, data.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return (
    codes.includes("3701") ||
    codes.includes("-2015") ||
    messages.includes("invalid api-key") ||
    messages.includes("permissions for action")
  );
}

type Props = {
  livePollingEnabled?: boolean;
};

export function SystemStatusPanel({ livePollingEnabled = true }: Props) {
  const [data, setData] = useState<SystemStatus | null>(null);
  const [authCheck, setAuthCheck] = useState<ExchangeAuthCheck | null>(null);
  const { t } = useI18n();

  useEffect(() => {
    if (DASHBOARD_PASSIVE_MODE || !livePollingEnabled) return;
    const load = async () => {
      const status = await apiGet<SystemStatus>("/api/system/status").catch(() => null);
      if (status) setData(status);
    };
    const loadAuth = async () => {
      const check = await apiPost<ExchangeAuthCheck>("/api/exchange/auth-check", {}).catch(() => null);
      if (check) setAuthCheck(check);
    };
    void load();
    void loadAuth();
    const timer = setInterval(load, 5000);
    const authTimer = setInterval(loadAuth, 30_000);
    return () => {
      clearInterval(timer);
      clearInterval(authTimer);
    };
  }, [livePollingEnabled]);

  const showAuthDanger = hasAuthPermissionError(authCheck);

  return (
    <Panel title={t("systemStatus.title")}>
      {showAuthDanger ? (
        <div className="mb-3 rounded-lg border border-tertiary/60 bg-tertiary/15 p-2 text-xs text-tertiary">
          <p className="font-bold">Binance TR API Yetki Hatasi (3701 / Invalid API-key)</p>
          <p className="mt-1">{authCheck?.hint ?? authCheck?.reason ?? "Spot trade izni veya whitelist IP kontrol edilmeli."}</p>
          {authCheck?.actions?.[0] ? <p className="mt-1">- {authCheck.actions[0]}</p> : null}
        </div>
      ) : null}
      {data?.paused ? (
        <div className="mb-3 rounded-lg border border-tertiary/50 bg-tertiary/10 p-2 text-xs text-tertiary">
          {t("systemStatus.pausedPrefix")} {data.pauseReason ?? t("systemStatus.riskBreaker")}
        </div>
      ) : null}
      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-on-surface-variant">{t("systemStatus.system")}</span>
          <span className={`font-bold ${data?.paused ? "text-tertiary" : "text-secondary"}`}>
            {data?.status ?? t("systemStatus.loading")}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-on-surface-variant">{t("systemStatus.openPositions")}</span>
          <span className="text-secondary font-bold">{data?.openTrades ?? "-"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-on-surface-variant">{t("systemStatus.riskGuard")}</span>
          <span className="text-primary font-bold">{data?.riskGuard ?? t("systemStatus.active")}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-on-surface-variant">{t("systemStatus.consecutiveLoss")}</span>
          <span className="text-tertiary font-bold">{data?.consecutiveLosses ?? 0}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-on-surface-variant">{t("systemStatus.dailyPnl")}</span>
          <span className={`font-bold ${(data?.totalPnl ?? 0) >= 0 ? "text-secondary" : "text-tertiary"}`}>
            {typeof data?.totalPnl === "number" ? data.totalPnl.toFixed(2) : "-"}
          </span>
        </div>
      </div>
    </Panel>
  );
}
