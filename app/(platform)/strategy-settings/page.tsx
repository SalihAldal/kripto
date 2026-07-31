"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut } from "@/lib/client-api";
import { Panel } from "@/src/components/common/panel";
import { useToast } from "@/src/lib/use-toast";
import { ToastStack } from "@/src/components/common/toast-stack";
import { useI18n } from "@/src/i18n/provider";

type StrategyConfig = {
  trade: {
    budgetPerTradeTry: number;
    maxOpenPositions: number;
    targetProfitPercent: number;
    stopLossPercent: number;
    trailingStopEnabled: boolean;
    maxWaitSec: number;
    cooldownSec: number;
    allowSameCoinReentry: boolean;
  };
  ai: {
    aiScoreThreshold: number;
    technicalMinScore: number;
    newsMinScore: number;
    riskVetoLevel: number;
    consensusMinScore: number;
    noTradeThreshold: number;
  };
  autoRound: {
    totalRounds: number;
    waitBetweenRoundsSec: number;
    onRoundFailure: "continue" | "pause" | "stop";
    onLoss: "continue" | "stop";
    onProfit: "continue" | "stop";
  };
  coinFilter: {
    bannedCoins: string[];
    allowedCoins: string[];
    minVolume24h: number;
    maxSpreadPercent: number;
    maxVolatilityPercent: number;
  };
  report: {
    defaultDateRange: "daily" | "weekly" | "monthly" | "custom";
    exportFormats: Array<"csv" | "json" | "xlsx">;
    includeCommission: boolean;
  };
};

type ConfigEnvelope = {
  version: number;
  updatedAt: string;
  updatedBy?: string;
  note?: string;
  config: StrategyConfig;
};

export default function StrategySettingsPage() {
  const { t } = useI18n();
  const { items: toasts, push } = useToast();
  const [active, setActive] = useState<ConfigEnvelope | null>(null);
  const [draft, setDraft] = useState<StrategyConfig | null>(null);
  const [versions, setVersions] = useState<ConfigEnvelope[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      const [cfg, vers] = await Promise.all([
        apiGet<{ active: ConfigEnvelope }>("/api/strategy/config").catch(() => null),
        apiGet<ConfigEnvelope[]>("/api/strategy/config/versions?limit=20").catch(() => []),
      ]);
      if (cfg?.active) {
        setActive(cfg.active);
        setDraft(cfg.active.config);
      }
      setVersions(vers ?? []);
      setLoading(false);
    };
    void load();
  }, []);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const updated = await apiPut<ConfigEnvelope>("/api/strategy/config", draft);
      setActive(updated);
      setDraft(updated.config);
      const vers = await apiGet<ConfigEnvelope[]>("/api/strategy/config/versions?limit=20").catch(() => []);
      setVersions(vers ?? []);
      push("Strateji ayarlari kaydedildi", "success");
    } catch (error) {
      push((error as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const rollback = async (version: number) => {
    try {
      const updated = await apiPost<ConfigEnvelope>("/api/strategy/config/rollback", { version });
      setActive(updated);
      setDraft(updated.config);
      const vers = await apiGet<ConfigEnvelope[]>("/api/strategy/config/versions?limit=20").catch(() => []);
      setVersions(vers ?? []);
      push(`v${version} rollback tamamlandi`, "success");
    } catch (error) {
      push((error as Error).message, "error");
    }
  };

  const setNum = (
    section: keyof StrategyConfig,
    field: string,
    value: number,
  ) => {
    if (!draft) return;
    setDraft({
      ...draft,
      [section]: {
        ...(draft[section] as Record<string, unknown>),
        [field]: value,
      },
    } as StrategyConfig);
  };

  const setBool = (
    section: keyof StrategyConfig,
    field: string,
    value: boolean,
  ) => {
    if (!draft) return;
    setDraft({
      ...draft,
      [section]: {
        ...(draft[section] as Record<string, unknown>),
        [field]: value,
      },
    } as StrategyConfig);
  };

  const setTextList = (section: "coinFilter", field: "bannedCoins" | "allowedCoins", raw: string) => {
    if (!draft) return;
    const list = raw
      .split(",")
      .map((x) => x.trim().toUpperCase())
      .filter(Boolean);
    setDraft({
      ...draft,
      coinFilter: {
        ...draft.coinFilter,
        [field]: list,
      },
    });
  };

  if (loading || !draft) {
    return (
      <div className="space-y-5">
        <h1 className="text-3xl font-black tracking-tight">{t("strategySettings.title")}</h1>
        <Panel title="Yukleniyor...">
          <p className="text-sm text-on-surface-variant">Konfigurasyon verisi aliniyor.</p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ToastStack items={toasts} />
      <h1 className="text-3xl font-black tracking-tight">{t("strategySettings.title")}</h1>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-8 space-y-4">
          <Panel title="Islem Ayarlari">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              <label>Islem basina butce (TRY)<input className="mt-1 w-full rounded bg-surface-container px-2 py-1" type="number" value={draft.trade.budgetPerTradeTry} onChange={(e) => setNum("trade", "budgetPerTradeTry", Number(e.target.value || 0))} /></label>
              <label>Maks acik pozisyon<input className="mt-1 w-full rounded bg-surface-container px-2 py-1" type="number" value={draft.trade.maxOpenPositions} onChange={(e) => setNum("trade", "maxOpenPositions", Number(e.target.value || 0))} /></label>
              <label>Hedef kar %<input className="mt-1 w-full rounded bg-surface-container px-2 py-1" type="number" value={draft.trade.targetProfitPercent} onChange={(e) => setNum("trade", "targetProfitPercent", Number(e.target.value || 0))} /></label>
              <label>Stop-loss %<input className="mt-1 w-full rounded bg-surface-container px-2 py-1" type="number" value={draft.trade.stopLossPercent} onChange={(e) => setNum("trade", "stopLossPercent", Number(e.target.value || 0))} /></label>
              <label>Maks bekleme (sn)<input className="mt-1 w-full rounded bg-surface-container px-2 py-1" type="number" value={draft.trade.maxWaitSec} onChange={(e) => setNum("trade", "maxWaitSec", Number(e.target.value || 0))} /></label>
              <label>Cooldown (sn)<input className="mt-1 w-full rounded bg-surface-container px-2 py-1" type="number" value={draft.trade.cooldownSec} onChange={(e) => setNum("trade", "cooldownSec", Number(e.target.value || 0))} /></label>
              <label className="flex items-center justify-between rounded bg-surface-container px-3 py-2">Trailing stop<input type="checkbox" checked={draft.trade.trailingStopEnabled} onChange={(e) => setBool("trade", "trailingStopEnabled", e.target.checked)} /></label>
              <label className="flex items-center justify-between rounded bg-surface-container px-3 py-2">Ayni coin tekrar alim<input type="checkbox" checked={draft.trade.allowSameCoinReentry} onChange={(e) => setBool("trade", "allowSameCoinReentry", e.target.checked)} /></label>
            </div>
          </Panel>
          <Panel title="AI Ayarlari">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              <label>AI skor esigi<input className="mt-1 w-full rounded bg-surface-container px-2 py-1" type="number" value={draft.ai.aiScoreThreshold} onChange={(e) => setNum("ai", "aiScoreThreshold", Number(e.target.value || 0))} /></label>
              <label>Teknik min skor<input className="mt-1 w-full rounded bg-surface-container px-2 py-1" type="number" value={draft.ai.technicalMinScore} onChange={(e) => setNum("ai", "technicalMinScore", Number(e.target.value || 0))} /></label>
              <label>Haber min skoru<input className="mt-1 w-full rounded bg-surface-container px-2 py-1" type="number" value={draft.ai.newsMinScore} onChange={(e) => setNum("ai", "newsMinScore", Number(e.target.value || 0))} /></label>
              <label>Risk veto seviyesi<input className="mt-1 w-full rounded bg-surface-container px-2 py-1" type="number" value={draft.ai.riskVetoLevel} onChange={(e) => setNum("ai", "riskVetoLevel", Number(e.target.value || 0))} /></label>
              <label>Consensus min skor<input className="mt-1 w-full rounded bg-surface-container px-2 py-1" type="number" value={draft.ai.consensusMinScore} onChange={(e) => setNum("ai", "consensusMinScore", Number(e.target.value || 0))} /></label>
              <label>No-trade esigi<input className="mt-1 w-full rounded bg-surface-container px-2 py-1" type="number" value={draft.ai.noTradeThreshold} onChange={(e) => setNum("ai", "noTradeThreshold", Number(e.target.value || 0))} /></label>
            </div>
          </Panel>
          <Panel title="Oto Tur + Coin Filtre + Rapor">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              <label>Toplam tur<input className="mt-1 w-full rounded bg-surface-container px-2 py-1" type="number" value={draft.autoRound.totalRounds} onChange={(e) => setNum("autoRound", "totalRounds", Number(e.target.value || 0))} /></label>
              <label>Tur arasi bekleme (sn)<input className="mt-1 w-full rounded bg-surface-container px-2 py-1" type="number" value={draft.autoRound.waitBetweenRoundsSec} onChange={(e) => setNum("autoRound", "waitBetweenRoundsSec", Number(e.target.value || 0))} /></label>
              <label>Basarisiz tur davranisi
                <select className="mt-1 w-full rounded bg-surface-container px-2 py-1" value={draft.autoRound.onRoundFailure} onChange={(e) => setDraft({ ...draft, autoRound: { ...draft.autoRound, onRoundFailure: e.target.value as "continue" | "pause" | "stop" } })}>
                  <option value="continue">Devam</option><option value="pause">Duraklat</option><option value="stop">Durdur</option>
                </select>
              </label>
              <label>Zarar sonrasi
                <select className="mt-1 w-full rounded bg-surface-container px-2 py-1" value={draft.autoRound.onLoss} onChange={(e) => setDraft({ ...draft, autoRound: { ...draft.autoRound, onLoss: e.target.value as "continue" | "stop" } })}>
                  <option value="continue">Devam</option><option value="stop">Dur</option>
                </select>
              </label>
              <label>Kar sonrasi
                <select className="mt-1 w-full rounded bg-surface-container px-2 py-1" value={draft.autoRound.onProfit} onChange={(e) => setDraft({ ...draft, autoRound: { ...draft.autoRound, onProfit: e.target.value as "continue" | "stop" } })}>
                  <option value="continue">Devam</option><option value="stop">Dur</option>
                </select>
              </label>
              <label>Yasakli coinler (virgul)<input className="mt-1 w-full rounded bg-surface-container px-2 py-1" value={draft.coinFilter.bannedCoins.join(",")} onChange={(e) => setTextList("coinFilter", "bannedCoins", e.target.value)} /></label>
              <label>Izinli coinler (virgul)<input className="mt-1 w-full rounded bg-surface-container px-2 py-1" value={draft.coinFilter.allowedCoins.join(",")} onChange={(e) => setTextList("coinFilter", "allowedCoins", e.target.value)} /></label>
              <label>Min hacim<input className="mt-1 w-full rounded bg-surface-container px-2 py-1" type="number" value={draft.coinFilter.minVolume24h} onChange={(e) => setNum("coinFilter", "minVolume24h", Number(e.target.value || 0))} /></label>
              <label>Maks spread %<input className="mt-1 w-full rounded bg-surface-container px-2 py-1" type="number" value={draft.coinFilter.maxSpreadPercent} onChange={(e) => setNum("coinFilter", "maxSpreadPercent", Number(e.target.value || 0))} /></label>
              <label>Maks volatilite %<input className="mt-1 w-full rounded bg-surface-container px-2 py-1" type="number" value={draft.coinFilter.maxVolatilityPercent} onChange={(e) => setNum("coinFilter", "maxVolatilityPercent", Number(e.target.value || 0))} /></label>
              <label>Varsayilan tarih filtresi
                <select className="mt-1 w-full rounded bg-surface-container px-2 py-1" value={draft.report.defaultDateRange} onChange={(e) => setDraft({ ...draft, report: { ...draft.report, defaultDateRange: e.target.value as "daily" | "weekly" | "monthly" | "custom" } })}>
                  <option value="daily">Gunluk</option><option value="weekly">Haftalik</option><option value="monthly">Aylik</option><option value="custom">Ozel</option>
                </select>
              </label>
              <label>Export formatlari (virgul: csv,json,xlsx)<input className="mt-1 w-full rounded bg-surface-container px-2 py-1" value={draft.report.exportFormats.join(",")} onChange={(e) => setDraft({ ...draft, report: { ...draft.report, exportFormats: e.target.value.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean) as Array<"csv" | "json" | "xlsx"> } })} /></label>
              <label className="flex items-center justify-between rounded bg-surface-container px-3 py-2">Komisyon dahil gosterim<input type="checkbox" checked={draft.report.includeCommission} onChange={(e) => setBool("report", "includeCommission", e.target.checked)} /></label>
            </div>
          </Panel>
          <div className="flex justify-end">
            <button disabled={saving} onClick={save} className="rounded-lg bg-primary px-5 py-2 text-sm font-black text-[#002e6a] disabled:opacity-60">
              {saving ? "Kaydediliyor..." : "Ayarlari Kaydet"}
            </button>
          </div>
        </div>
        <div className="xl:col-span-4 space-y-4">
          <Panel title="Versiyon Gecmisi / Rollback">
            <div className="space-y-2 text-xs">
              <div className="rounded-md bg-surface-container px-3 py-2">
                <p className="font-bold">Aktif Versiyon: v{active?.version ?? "-"}</p>
                <p className="text-on-surface-variant">Guncelleme: {active?.updatedAt ? new Date(active.updatedAt).toLocaleString() : "-"}</p>
              </div>
              {versions.map((v) => (
                <div key={`${v.version}-${v.updatedAt}`} className="rounded-md bg-surface-container px-3 py-2 flex items-center justify-between gap-2">
                  <div>
                    <p className="font-bold">v{v.version}</p>
                    <p className="text-on-surface-variant">{new Date(v.updatedAt).toLocaleString()}</p>
                    <p className="text-on-surface-variant break-all">{v.note ?? "-"}</p>
                  </div>
                  <button onClick={() => rollback(v.version)} className="rounded bg-surface-container-high px-2 py-1 font-bold hover:bg-surface">
                    Rollback
                  </button>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
