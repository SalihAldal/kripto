"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/src/i18n/provider";
import { useRiskPulse } from "@/src/features/shell/use-risk-pulse";

export function Topbar() {
  const { t, locale, locales, setLocale, localeLabels } = useI18n();
  const [isRiskOpen, setIsRiskOpen] = useState(false);
  const riskRef = useRef<HTMLDivElement | null>(null);
  const { risk, timeline, activeTrendIdx, setActiveTrendIdx, selectedTrend, freshness, lastUpdatedAt } = useRiskPulse(10000);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!riskRef.current) return;
      if (!riskRef.current.contains(event.target as Node)) {
        setIsRiskOpen(false);
      }
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsRiskOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onEscape);
    };
  }, []);

  const pulseClass =
    risk?.strictness === "very_strict"
      ? "bg-tertiary"
      : risk?.strictness === "strict"
        ? "bg-primary"
        : "bg-secondary";
  const strictnessLabel =
    risk?.strictness === "very_strict" ? "VERY_STRICT" : risk?.strictness === "strict" ? "STRICT" : "NORMAL";
  const freshnessClass =
    freshness === "fresh" ? "text-secondary" : freshness === "stale" ? "text-tertiary" : "text-on-surface-variant";
  const freshnessLabel = freshness === "fresh" ? t("topbar.fresh") : freshness === "stale" ? t("topbar.stale") : t("topbar.cold");

  return (
    <header className="h-16 border-b border-outline-variant/20 bg-surface/80 backdrop-blur-xl flex items-center justify-between px-4 md:px-6 sticky top-0 z-50">
      <div className="flex items-center gap-8">
        <span className="text-xl font-black tracking-tighter text-primary">KINETIC</span>
        <div className="hidden lg:flex items-center gap-5 text-sm text-on-surface-variant">
          <span>BTC/USDT</span>
          <span>ETH/USDT</span>
          <span>SOL/USDT</span>
        </div>
      </div>
      <div className="flex items-center gap-3 text-xs font-bold uppercase tracking-widest">
        <div ref={riskRef} className="group relative flex items-center gap-2 rounded-md border border-outline-variant/30 bg-surface-container-low px-2 py-1">
          <span className={`inline-block h-2 w-2 rounded-full ${pulseClass} animate-pulse`} />
          <span className="text-on-surface-variant">{t("topbar.riskPulse")}</span>
          <button
            type="button"
            onClick={() => setIsRiskOpen((prev) => !prev)}
            className="text-on-surface outline-none focus-visible:ring-1 focus-visible:ring-primary/60 rounded px-0.5"
            aria-expanded={isRiskOpen}
            aria-label={t("topbar.riskPulse")}
          >
            {t("topbar.strictness")}: {strictnessLabel} / C{risk?.minConfidence ?? 0}
          </button>
          <div
            className={`absolute right-0 top-[120%] z-50 w-[320px] rounded-lg border border-outline-variant/40 bg-surface-container p-3 text-[11px] normal-case tracking-normal shadow-xl transition ${
              isRiskOpen ? "opacity-100" : "pointer-events-none opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
            }`}
          >
            <div className="mb-2 flex items-center justify-between border-b border-outline-variant/30 pb-2">
              <span className="text-on-surface-variant">
                {t("topbar.lastUpdate")}: {lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleTimeString(locale === "tr" ? "tr-TR" : "en-US") : "--:--:--"}
              </span>
              <span className={freshnessClass}>{freshnessLabel}</span>
            </div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-on-surface-variant">{t("topbar.winRate")}</span>
              <span className={risk && risk.reasonData.winRatePercent < 55 ? "text-tertiary" : "text-secondary"}>
                {risk ? risk.reasonData.winRatePercent.toFixed(2) : "0.00"}%
              </span>
            </div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-on-surface-variant">{t("topbar.drawdown")}</span>
              <span className={risk && risk.reasonData.maxDrawdown > 8 ? "text-tertiary" : "text-primary"}>
                {risk ? risk.reasonData.maxDrawdown.toFixed(2) : "0.00"}
              </span>
            </div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-on-surface-variant">{t("topbar.confDelta")}</span>
              <span
                className={
                  risk && risk.reasonData.deltaConfidence > 0
                    ? "text-tertiary"
                    : risk && risk.reasonData.deltaConfidence < 0
                      ? "text-secondary"
                      : "text-on-surface"
                }
              >
                {risk && risk.reasonData.deltaConfidence >= 0 ? "+" : ""}
                {risk?.reasonData.deltaConfidence ?? 0}
              </span>
            </div>
            <div className="mt-3 border-t border-outline-variant/30 pt-2">
              <p className="text-on-surface-variant">{t("topbar.policyReason")}</p>
              <p className="line-clamp-3 text-on-surface">{risk?.reason ?? "-"}</p>
            </div>
            <div className="mt-3 border-t border-outline-variant/30 pt-2">
              <p className="text-on-surface-variant">{t("topbar.policyTrend")}</p>
              <div className="mt-2 flex h-14 items-end gap-1">
                {(timeline.length > 0 ? timeline : [{ at: "-", strictness: "normal", minConfidence: 0 }]).map((row, idx) => {
                  const height = row.minConfidence > 0 ? Math.min(52, Math.max(16, Math.round((row.minConfidence - 70) * 1.2))) : 16;
                  const barClass =
                    row.strictness === "very_strict"
                      ? "bg-tertiary"
                      : row.strictness === "strict"
                        ? "bg-primary"
                        : "bg-secondary";
                  return (
                    <div key={`${row.at}-${idx}`} className="flex flex-1 flex-col items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setActiveTrendIdx(idx)}
                        onMouseEnter={() => setActiveTrendIdx(idx)}
                        className={`w-full rounded-sm ${barClass} ${activeTrendIdx === idx ? "ring-1 ring-on-surface/60" : ""}`}
                        style={{ height }}
                        title={`${new Date(row.at).toLocaleTimeString()} | ${row.strictness.toUpperCase()} | C${row.minConfidence}`}
                        aria-label={`trend-${idx}`}
                      />
                      <span className="text-[9px] text-on-surface-variant">C{row.minConfidence || 0}</span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 rounded-md border border-outline-variant/30 bg-surface-container-high/40 px-2 py-1.5 text-[10px]">
                {selectedTrend ? (
                  <>
                    <p className="text-on-surface-variant">
                      {t("topbar.trendDetail")}: {new Date(selectedTrend.at).toLocaleTimeString()} / {selectedTrend.strictness.toUpperCase()} / C
                      {selectedTrend.minConfidence}
                    </p>
                    <p className="line-clamp-2 text-on-surface">{selectedTrend.reason ?? risk?.reason ?? "-"}</p>
                  </>
                ) : (
                  <p className="text-on-surface-variant">{t("topbar.noTrendData")}</p>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-1 rounded-md border border-outline-variant/30 bg-surface-container-low px-1 py-1">
          {locales.map((code) => (
            <button
              key={code}
              onClick={() => setLocale(code)}
              className={`rounded px-2 py-0.5 text-[10px] ${
                locale === code ? "bg-primary text-[#002e6a]" : "text-on-surface-variant hover:text-on-surface"
              }`}
              aria-label={`${t("topbar.language")} ${localeLabels[code]}`}
            >
              {localeLabels[code]}
            </button>
          ))}
        </div>
        <span className="inline-block h-2 w-2 rounded-full bg-secondary animate-pulse" />
        <span className="text-secondary">{t("topbar.liveStatus")}</span>
      </div>
    </header>
  );
}
