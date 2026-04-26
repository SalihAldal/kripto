"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPut } from "@/lib/client-api";
import { Panel } from "@/src/components/common/panel";
import { useI18n } from "@/src/i18n/provider";

export function RiskSettingsPanel() {
  const { t } = useI18n();
  const [drawdown, setDrawdown] = useState(2.5);
  const [weeklyDrawdown, setWeeklyDrawdown] = useState(7);
  const [maxRiskPerTrade, setMaxRiskPerTrade] = useState(1.2);
  const [dailyLossReferenceTry, setDailyLossReferenceTry] = useState(5000);
  const [weeklyLossReferenceTry, setWeeklyLossReferenceTry] = useState(5000);
  const [maxLeverage, setMaxLeverage] = useState(10);
  const [maxOpenPositions, setMaxOpenPositions] = useState(3);
  const [cooldownMinutes, setCooldownMinutes] = useState(30);
  const [confidenceThreshold, setConfidenceThreshold] = useState(70);
  const [maxSpread, setMaxSpread] = useState(0.25);
  const [autoBrake, setAutoBrake] = useState(true);
  const [stopLossRequired, setStopLossRequired] = useState(true);
  const [paused, setPaused] = useState(false);
  const [saving, setSaving] = useState(false);

  const payload = useMemo(
    () => ({
      maxLeverage,
      maxOpenPositions,
      maxDailyLossPercent: drawdown,
      stopLossRequired,
      emergencyBrakeEnabled: autoBrake,
      cooldownMinutes,
      maxRiskPerTrade,
      dailyLossReferenceTry,
      weeklyLossReferenceTry,
      maxWeeklyLossPercent: weeklyDrawdown,
      metadata: {
        minConfidenceThreshold: confidenceThreshold,
        maxSpreadThreshold: maxSpread,
        dailyLossReferenceTry,
        weeklyLossReferenceTry,
        maxRiskPerTrade,
        maxWeeklyLossPercent: weeklyDrawdown,
      },
    }),
    [
      autoBrake,
      confidenceThreshold,
      cooldownMinutes,
      dailyLossReferenceTry,
      drawdown,
      maxLeverage,
      maxOpenPositions,
      maxSpread,
      maxRiskPerTrade,
      stopLossRequired,
      weeklyDrawdown,
      weeklyLossReferenceTry,
    ],
  );

  useEffect(() => {
    const load = async () => {
      const [risk, status] = await Promise.all([
        apiGet<{
          maxLeverage?: number;
          maxOpenPositions?: number;
          maxDailyLossPercent?: number;
          stopLossRequired?: boolean;
          emergencyBrakeEnabled?: boolean;
          cooldownMinutes?: number;
          maxRiskPerTrade?: number;
          dailyLossReferenceTry?: number;
          weeklyLossReferenceTry?: number;
          maxWeeklyLossPercent?: number;
          metadata?: {
            minConfidenceThreshold?: number;
            maxSpreadThreshold?: number;
            dailyLossReferenceTry?: number;
            weeklyLossReferenceTry?: number;
            maxRiskPerTrade?: number;
            maxWeeklyLossPercent?: number;
          };
        }>("/api/risk/config").catch(() => null),
        apiGet<{ paused?: boolean }>("/api/system/status").catch(() => null),
      ]);

      if (risk) {
        setDrawdown(risk.maxDailyLossPercent ?? 2.5);
        setWeeklyDrawdown(risk.maxWeeklyLossPercent ?? risk.metadata?.maxWeeklyLossPercent ?? 7);
        setMaxLeverage(risk.maxLeverage ?? 10);
        setMaxOpenPositions(risk.maxOpenPositions ?? 3);
        setAutoBrake(risk.emergencyBrakeEnabled ?? true);
        setStopLossRequired(risk.stopLossRequired ?? true);
        setCooldownMinutes(risk.cooldownMinutes ?? 30);
        setConfidenceThreshold(risk.metadata?.minConfidenceThreshold ?? 70);
        setMaxSpread(risk.metadata?.maxSpreadThreshold ?? 0.25);
        setDailyLossReferenceTry(risk.dailyLossReferenceTry ?? risk.metadata?.dailyLossReferenceTry ?? 5000);
        setWeeklyLossReferenceTry(risk.weeklyLossReferenceTry ?? risk.metadata?.weeklyLossReferenceTry ?? 5000);
        setMaxRiskPerTrade(risk.maxRiskPerTrade ?? risk.metadata?.maxRiskPerTrade ?? 1.2);
      }
      setPaused(Boolean(status?.paused));
    };
    void load();
  }, []);

  const saveSettings = async () => {
    setSaving(true);
    try {
      await apiPut("/api/risk/config", payload);
    } finally {
      setSaving(false);
    }
  };

  const togglePause = async (next: boolean) => {
    setSaving(true);
    try {
      await apiPost("/api/risk/system-control", {
        paused: next,
        reason: next ? `${t("riskSettings.pause")} (panel)` : `${t("riskSettings.resume")} (panel)`,
        minutes: next ? cooldownMinutes : undefined,
      });
      setPaused(next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel title={t("riskSettings.title")}>
      <div className="space-y-4">
        <label className="block">
          <span className="text-xs text-on-surface-variant">{t("riskSettings.dailyDrawdown")}</span>
          <input
            type="range"
            min={0.5}
            max={8}
            step={0.1}
            value={drawdown}
            onChange={(e) => setDrawdown(Number(e.target.value))}
            className="mt-2 w-full accent-primary"
          />
          <span className="text-sm font-bold">{drawdown.toFixed(1)}%</span>
        </label>
        {/* Neden: Haftalik zarar limiti risk katmaninda aktif; panelden ayarlanabilir olmali. */}
        <label className="block">
          <span className="text-xs text-on-surface-variant">Haftalik maksimum zarar limiti</span>
          <input
            type="range"
            min={1}
            max={20}
            step={0.1}
            value={weeklyDrawdown}
            onChange={(e) => setWeeklyDrawdown(Number(e.target.value))}
            className="mt-2 w-full accent-primary"
          />
          <span className="text-sm font-bold">{weeklyDrawdown.toFixed(1)}%</span>
        </label>

        {/* Neden: Islem basi risk yuzdesi agresif ama kontrollu optimizasyonun ana parametresi. */}
        <label className="block">
          <span className="text-xs text-on-surface-variant">Islem basi risk limiti (% sermaye)</span>
          <input
            type="range"
            min={0.1}
            max={5}
            step={0.1}
            value={maxRiskPerTrade}
            onChange={(e) => setMaxRiskPerTrade(Number(e.target.value))}
            className="mt-2 w-full accent-primary"
          />
          <span className="text-sm font-bold">{maxRiskPerTrade.toFixed(1)}%</span>
        </label>

        <label className="block">
          <span className="text-xs text-on-surface-variant">{t("riskSettings.maxLeverage")}</span>
          <input
            type="range"
            min={1}
            max={50}
            value={maxLeverage}
            onChange={(e) => setMaxLeverage(Number(e.target.value))}
            className="mt-2 w-full accent-primary"
          />
          <span className="text-sm font-bold">{maxLeverage}x</span>
        </label>

        <label className="block">
          <span className="text-xs text-on-surface-variant">{t("riskSettings.maxOpenPositions")}</span>
          <input
            type="range"
            min={1}
            max={12}
            value={maxOpenPositions}
            onChange={(e) => setMaxOpenPositions(Number(e.target.value))}
            className="mt-2 w-full accent-primary"
          />
          <span className="text-sm font-bold">{maxOpenPositions}</span>
        </label>

        <label className="block">
          <span className="text-xs text-on-surface-variant">{t("riskSettings.minConfidence")}</span>
          <input
            type="range"
            min={50}
            max={99}
            value={confidenceThreshold}
            onChange={(e) => setConfidenceThreshold(Number(e.target.value))}
            className="mt-2 w-full accent-primary"
          />
          <span className="text-sm font-bold">{confidenceThreshold}%</span>
        </label>

        <label className="block">
          <span className="text-xs text-on-surface-variant">{t("riskSettings.maxSpread")}</span>
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.01}
            value={maxSpread}
            onChange={(e) => setMaxSpread(Number(e.target.value))}
            className="mt-2 w-full accent-primary"
          />
          <span className="text-sm font-bold">{maxSpread.toFixed(2)}%</span>
        </label>

        <label className="block">
          <span className="text-xs text-on-surface-variant">{t("riskSettings.cooldown")}</span>
          <input
            type="range"
            min={1}
            max={120}
            value={cooldownMinutes}
            onChange={(e) => setCooldownMinutes(Number(e.target.value))}
            className="mt-2 w-full accent-primary"
          />
          <span className="text-sm font-bold">{cooldownMinutes}m</span>
        </label>

        <label className="block">
          <span className="text-xs text-on-surface-variant">Gunluk zarar referans bakiyesi (TRY)</span>
          <input
            type="range"
            min={500}
            max={500000}
            step={500}
            value={dailyLossReferenceTry}
            onChange={(e) => setDailyLossReferenceTry(Number(e.target.value))}
            className="mt-2 w-full accent-primary"
          />
          <span className="text-sm font-bold">{dailyLossReferenceTry.toLocaleString("tr-TR")} TRY</span>
        </label>
        {/* Neden: Haftalik breaker hesaplamasi gunlukten bagimsiz referans ister. */}
        <label className="block">
          <span className="text-xs text-on-surface-variant">Haftalik zarar referans bakiyesi (TRY)</span>
          <input
            type="range"
            min={500}
            max={1000000}
            step={500}
            value={weeklyLossReferenceTry}
            onChange={(e) => setWeeklyLossReferenceTry(Number(e.target.value))}
            className="mt-2 w-full accent-primary"
          />
          <span className="text-sm font-bold">{weeklyLossReferenceTry.toLocaleString("tr-TR")} TRY</span>
        </label>

        <label className="flex items-center justify-between rounded-lg bg-surface-container-low px-3 py-2">
          <span className="text-sm">{t("riskSettings.emergencyBrake")}</span>
          <input type="checkbox" checked={autoBrake} onChange={(e) => setAutoBrake(e.target.checked)} />
        </label>
        {/* Neden: Stop-loss zorunlulugu risk modulu tarafinda hard gate; UI'dan kontrol edilmeli. */}
        <label className="flex items-center justify-between rounded-lg bg-surface-container-low px-3 py-2">
          <span className="text-sm">Stop-loss zorunlu</span>
          <input type="checkbox" checked={stopLossRequired} onChange={(e) => setStopLossRequired(e.target.checked)} />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            disabled={saving}
            onClick={saveSettings}
            className="rounded-lg bg-surface-container px-4 py-2 text-sm font-bold hover:bg-surface-container-high disabled:opacity-60"
          >
            {saving ? t("riskSettings.saving") : t("riskSettings.save")}
          </button>
          <button
            disabled={saving}
            onClick={() => togglePause(!paused)}
            className="rounded-lg bg-linear-to-br from-tertiary to-primary-container px-4 py-2 text-sm font-black text-[#002e6a] disabled:opacity-60"
          >
            {paused ? t("riskSettings.resume") : t("riskSettings.pause")}
          </button>
        </div>
      </div>
    </Panel>
  );
}
