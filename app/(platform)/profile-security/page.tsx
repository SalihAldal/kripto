"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/client-api";
import { useI18n } from "@/src/i18n/provider";

const BALANCE_CACHE_KEY = "kinetic.balance.lastGood.profile";
type BalanceState = {
  totalAssets: number;
  nonZeroAssets: number;
  exchangePlatform?: string;
  exchangeEnv?: string;
  error?: string | null;
  errorCode?: string | null;
  errorHint?: string | null;
  rawError?: string | null;
  updatedAt: string;
  balances: Array<{ asset: string; free: number; locked: number; total: number }>;
};

function readCachedBalance(): BalanceState | null {
  if (typeof window === "undefined") return null;
  const cachedRaw = window.localStorage.getItem(BALANCE_CACHE_KEY);
  if (!cachedRaw) return null;
  try {
    const cached = JSON.parse(cachedRaw) as BalanceState;
    return (cached.balances?.length ?? 0) > 0 ? cached : null;
  } catch {
    return null;
  }
}

export default function ProfileSecurityPage() {
  const { t, localeTag } = useI18n();
  const [status, setStatus] = useState<{ paused: boolean; emergencyBrakeEnabled: boolean; updatedAt: string } | null>(null);
  const [balanceFetchError, setBalanceFetchError] = useState<string | null>(null);
  const [balance, setBalance] = useState<BalanceState | null>(() => readCachedBalance());

  useEffect(() => {
    const load = async () => {
      const data = await apiGet<{ paused: boolean; emergencyBrakeEnabled: boolean; updatedAt: string }>("/api/system/status").catch(() => null);
      if (data) setStatus(data);
      const bal = await apiGet<{
        totalAssets: number;
        nonZeroAssets: number;
        exchangePlatform?: string;
        exchangeEnv?: string;
        error?: string | null;
        errorCode?: string | null;
        errorHint?: string | null;
        rawError?: string | null;
        updatedAt: string;
        balances: Array<{ asset: string; free: number; locked: number; total: number }>;
      }>("/api/exchange/balance").catch((error) => {
        const message = error instanceof Error ? error.message : "Balance request failed";
        setBalanceFetchError(message);
        return null;
      });
      if (bal) {
        setBalance((prev) => {
          const hasFresh = (bal.balances?.length ?? 0) > 0;
          if (hasFresh) {
            if (typeof window !== "undefined") {
              window.localStorage.setItem(BALANCE_CACHE_KEY, JSON.stringify(bal));
            }
            return bal;
          }
          if (prev && (prev.balances?.length ?? 0) > 0) {
            return {
              ...prev,
              error: bal.error ?? prev.error ?? null,
              errorCode: bal.errorCode ?? prev.errorCode ?? null,
              errorHint: bal.errorHint ?? prev.errorHint ?? null,
              rawError: bal.rawError ?? prev.rawError ?? null,
              updatedAt: bal.updatedAt ?? prev.updatedAt,
            };
          }
          return bal;
        });
      }
      if (bal) setBalanceFetchError(null);
    };
    void load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-black tracking-tight">{t("profile.title")}</h1>
      <div className="glass-panel rounded-xl p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-surface-container-low rounded-xl p-4">
          <p className="text-xs text-on-surface-variant uppercase">{t("profile.account")}</p>
          <p className="text-lg font-bold mt-2">{t("profile.user")}</p>
        </div>
        <div className="bg-surface-container-low rounded-xl p-4">
          <p className="text-xs text-on-surface-variant uppercase">{t("profile.riskProtection")}</p>
          <p className={`text-lg font-bold mt-2 ${status?.paused ? "text-tertiary" : "text-secondary"}`}>
            {status?.paused ? t("profile.paused") : t("profile.active")}
          </p>
          <p className="mt-1 text-xs text-on-surface-variant">
            {t("profile.emergencyBrake")}: {status?.emergencyBrakeEnabled ? t("profile.enabled") : t("profile.disabled")}
          </p>
          <p className="mt-1 text-[11px] text-on-surface-variant">
            {status?.updatedAt ? new Date(status.updatedAt).toLocaleString(localeTag) : "-"}
          </p>
        </div>
      </div>
      <div className="glass-panel rounded-xl p-6 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-on-surface-variant uppercase">{t("profile.balanceTitle")}</p>
          <p className="text-[11px] text-on-surface-variant">
            {t("profile.balanceUpdated")}: {balance?.updatedAt ? new Date(balance.updatedAt).toLocaleTimeString(localeTag) : "-"}
          </p>
        </div>
        <div className="rounded-md bg-surface-container-low px-3 py-2 text-xs flex flex-wrap items-center gap-3">
          <span>{t("profile.total")}: {balance?.nonZeroAssets ?? 0} / {balance?.totalAssets ?? 0}</span>
          <span>platform: {balance?.exchangePlatform ?? "-"}</span>
          <span>env: {balance?.exchangeEnv ?? "-"}</span>
        </div>
        {(balance?.error || balanceFetchError) ? (
          <div className="space-y-1">
            <p className="text-xs text-tertiary break-all">{balance?.error ?? balanceFetchError}</p>
            {balance?.errorHint ? <p className="text-[11px] text-on-surface-variant">{balance.errorHint}</p> : null}
            {balance?.rawError ? <p className="text-[10px] text-on-surface-variant/80 break-all">{balance.rawError}</p> : null}
          </div>
        ) : null}
        {(balance?.balances?.length ?? 0) === 0 ? (
          <p className="text-sm text-on-surface-variant">{t("profile.noBalance")}</p>
        ) : (
          <div className="max-h-72 overflow-y-auto rounded-md border border-outline-variant/30">
            <table className="w-full text-xs">
              <thead className="bg-surface-container-low sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2">{t("profile.asset")}</th>
                  <th className="text-right px-3 py-2">{t("profile.free")}</th>
                  <th className="text-right px-3 py-2">{t("profile.locked")}</th>
                  <th className="text-right px-3 py-2">{t("profile.total")}</th>
                </tr>
              </thead>
              <tbody>
                {balance!.balances.map((row) => (
                  <tr key={row.asset} className="border-t border-outline-variant/20">
                    <td className="px-3 py-2 font-semibold">{row.asset}</td>
                    <td className="px-3 py-2 text-right">{row.free.toFixed(8)}</td>
                    <td className="px-3 py-2 text-right">{row.locked.toFixed(8)}</td>
                    <td className="px-3 py-2 text-right font-bold">{row.total.toFixed(8)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
