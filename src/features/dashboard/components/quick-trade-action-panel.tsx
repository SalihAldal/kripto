"use client";

import { Panel } from "@/src/components/common/panel";
import { useI18n } from "@/src/i18n/provider";

export type SellTargetMetric = {
  label: string;
  value: string;
  tone: "positive" | "negative" | "neutral" | "warning";
};

type Props = {
  symbol: string;
  onAnalyze: () => void;
  onTrade: () => void;
  autoModeEnabled: boolean;
  onStartAutoMode: () => void;
  onStopAutoMode: () => void;
  autoStatusLabel: string;
  autoCycleText?: string;
  autoNextRunText?: string;
  qualityModeText?: string;
  tradeAmount: number;
  tradeAmountCurrency: "TRY" | "USDT";
  onTradeAmountChange: (value: number) => void;
  maxCoins: number;
  onMaxCoinsChange: (value: number) => void;
  leverage: number;
  onLeverageChange: (value: number) => void;
  onLeverageAnalyze?: () => void;
  loading: boolean;
  leverageLoading?: boolean;
  progressText?: string;
  flowActive?: boolean;
  sellEtaText?: string;
  sellTargetMetrics?: SellTargetMetric[];
  leverageInsightText?: string;
};

export function QuickTradeActionPanel({
  symbol,
  onAnalyze,
  onTrade,
  autoModeEnabled,
  onStartAutoMode,
  onStopAutoMode,
  autoStatusLabel,
  autoCycleText,
  autoNextRunText,
  qualityModeText,
  tradeAmount,
  tradeAmountCurrency,
  onTradeAmountChange,
  maxCoins,
  onMaxCoinsChange,
  leverage,
  onLeverageChange,
  onLeverageAnalyze,
  loading,
  leverageLoading = false,
  progressText,
  flowActive = false,
  sellEtaText,
  sellTargetMetrics,
  leverageInsightText,
}: Props) {
  const { t } = useI18n();
  const disabled = loading || flowActive;
  const metricToneClass: Record<SellTargetMetric["tone"], string> = {
    positive: "border-secondary/30 bg-secondary/10 text-secondary",
    negative: "border-tertiary/40 bg-tertiary/10 text-tertiary",
    warning: "border-primary/30 bg-primary/10 text-primary",
    neutral: "border-outline-variant/30 bg-surface-container-low text-on-surface-variant",
  };

  return (
    <Panel title={t("quickTrade.title")}>
      <p className="text-xs text-on-surface-variant">{t("quickTrade.scanUniverse")}</p>
      <p className="text-xs text-on-surface-variant mb-3">{t("quickTrade.focusMarket")} {symbol}</p>
      {flowActive ? (
        <p className="mb-2 rounded-lg border border-secondary/30 bg-secondary/10 px-2 py-1 text-xs text-secondary">
          {t("quickTrade.flowActive")}
        </p>
      ) : null}
      {autoModeEnabled ? (
        <p className="mb-2 rounded-lg border border-primary/30 bg-primary/10 px-2 py-1 text-xs text-primary">
          Otomatik spot mod aktif: analiz - alim - satis dongusu calisiyor.
        </p>
      ) : null}
      <div className="mb-2 rounded-lg border border-outline-variant/30 bg-surface-container-low px-2 py-1.5 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-on-surface-variant">Otomatik Durum</span>
          <span className={autoModeEnabled ? "font-bold text-secondary" : "font-bold text-on-surface-variant"}>
            {autoStatusLabel}
          </span>
        </div>
        {qualityModeText ? (
          <p className="mt-1 inline-flex rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
            {qualityModeText}
          </p>
        ) : null}
        {autoCycleText ? <p className="mt-1 text-[11px] font-semibold text-on-surface">{autoCycleText}</p> : null}
        {autoNextRunText ? <p className="mt-1 text-[11px] text-on-surface-variant">{autoNextRunText}</p> : null}
      </div>
      {progressText ? (
        <p className="mb-2 rounded-lg border border-primary/30 bg-primary/10 px-2 py-1 text-xs text-primary">
          {progressText}
        </p>
      ) : null}
      {sellEtaText ? (
        <p className="mb-2 rounded-lg border border-secondary/30 bg-secondary/10 px-2 py-1 text-xs text-secondary">
          {sellEtaText}
        </p>
      ) : null}
      {sellTargetMetrics && sellTargetMetrics.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {sellTargetMetrics.map((metric) => (
            <span
              key={metric.label}
              className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${metricToneClass[metric.tone]}`}
            >
              {metric.label}: {metric.value}
            </span>
          ))}
        </div>
      ) : null}
      {leverageInsightText ? (
        <p className="mb-2 rounded-lg border border-tertiary/30 bg-tertiary/10 px-2 py-1 text-xs text-tertiary">
          {leverageInsightText}
        </p>
      ) : null}
      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <label className="text-xs text-on-surface-variant">
            Islem Tutari ({tradeAmountCurrency})
            <input
              type="number"
              min={0}
              step={10}
              value={tradeAmount}
              onChange={(e) => onTradeAmountChange(Number(e.target.value || 0))}
              className="mt-1 w-full rounded-lg bg-surface-container-low px-2 py-2 text-sm text-on-surface"
            />
          </label>
          <label className="text-xs text-on-surface-variant">
            Kaldirac
            <select
              value={leverage}
              onChange={(e) => onLeverageChange(Number(e.target.value))}
              className="mt-1 w-full rounded-lg bg-surface-container-low px-2 py-2 text-sm text-on-surface"
            >
              {[1, 2, 3, 5, 10, 20].map((x) => (
                <option key={x} value={x}>
                  {x}x
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-on-surface-variant">
            Maks Coin
            <select
              value={maxCoins}
              onChange={(e) => onMaxCoinsChange(Number(e.target.value))}
              className="mt-1 w-full rounded-lg bg-surface-container-low px-2 py-2 text-sm text-on-surface"
            >
              {[1, 2, 3, 4, 5].map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          disabled={disabled}
          onClick={onAnalyze}
          className="w-full rounded-lg bg-surface-container px-4 py-2.5 text-sm font-bold hover:bg-surface-container-high disabled:opacity-60"
        >
          {loading ? t("quickTrade.analyzing") : flowActive ? t("quickTrade.flowContinue") : t("quickTrade.startAiAnalyze")}
        </button>
        <button
          disabled={disabled}
          onClick={onTrade}
          className="w-full rounded-lg bg-linear-to-br from-primary to-primary-container px-4 py-2.5 text-sm font-black text-[#002e6a] disabled:opacity-60"
        >
          {flowActive ? t("quickTrade.flowWaitingSell") : t("quickTrade.analyzeAndTrade")}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={autoModeEnabled}
            onClick={onStartAutoMode}
            className="w-full rounded-lg border border-secondary/30 bg-secondary/15 px-4 py-2.5 text-sm font-bold text-secondary disabled:opacity-50"
          >
            Otomatik Baslat
          </button>
          <button
            type="button"
            disabled={!autoModeEnabled}
            onClick={onStopAutoMode}
            className="w-full rounded-lg border border-tertiary/30 bg-tertiary/10 px-4 py-2.5 text-sm font-bold text-tertiary disabled:opacity-50"
          >
            Durdur
          </button>
        </div>
        {onLeverageAnalyze ? (
          <button
            disabled={disabled || leverageLoading}
            onClick={onLeverageAnalyze}
            className="w-full rounded-lg bg-linear-to-br from-tertiary to-surface-container-high px-4 py-2.5 text-sm font-black text-on-surface disabled:opacity-60"
          >
            {leverageLoading ? t("quickTrade.leverageAnalyzing") : t("quickTrade.deepLeverageAnalyze")}
          </button>
        ) : null}
      </div>
    </Panel>
  );
}
