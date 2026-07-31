"use client";

import { useMemo } from "react";
import { Panel } from "@/src/components/common/panel";
import type { PnlReportResponse } from "@/src/types/platform";

type Props = {
  data: PnlReportResponse | null;
  loading: boolean;
  error: string | null;
  filters: {
    period: "daily" | "weekly" | "monthly" | "custom";
    startDate: string;
    endDate: string;
    coin: string;
    aiModel: string;
    mode: "all" | "manual" | "auto";
  };
  onFilterChange: (key: string, value: string) => void;
  onRefresh: () => void;
  onExport: (format: "csv" | "excel") => void;
};

function currency(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(4)}`;
}

function barWidth(value: number, max: number) {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return "0%";
  return `${Math.max(3, Math.round((Math.abs(value) / max) * 100))}%`;
}

export function PnlReportDashboard({
  data,
  loading,
  error,
  filters,
  onFilterChange,
  onRefresh,
  onExport,
}: Props) {
  const maxCoinAbs = useMemo(() => {
    if (!data) return 0;
    return Math.max(
      ...data.charts.coinPnlDistribution.map((row) => Math.abs(row.value)),
      1,
    );
  }, [data]);
  const maxAiAbs = useMemo(() => {
    if (!data) return 0;
    return Math.max(...data.charts.aiPerformanceComparison.map((row) => Math.abs(row.value)), 1);
  }, [data]);

  return (
    <div className="space-y-4">
      <Panel
        title="PnL Rapor Filtreleri"
        right={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onExport("csv")}
              className="rounded-md bg-surface-container-high px-3 py-1 text-xs font-bold"
            >
              CSV
            </button>
            <button
              type="button"
              onClick={() => onExport("excel")}
              className="rounded-md bg-surface-container-high px-3 py-1 text-xs font-bold"
            >
              Excel
            </button>
            <button
              type="button"
              onClick={onRefresh}
              className="rounded-md bg-primary px-3 py-1 text-xs font-bold text-black"
            >
              Yenile
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
          <select
            value={filters.period}
            onChange={(e) => onFilterChange("period", e.target.value)}
            className="rounded-lg bg-surface-container-low px-2 py-2 text-sm"
          >
            <option value="daily">Gunluk</option>
            <option value="weekly">Haftalik</option>
            <option value="monthly">Aylik</option>
            <option value="custom">Ozel Aralik</option>
          </select>
          <input
            type="date"
            value={filters.startDate}
            onChange={(e) => onFilterChange("startDate", e.target.value)}
            className="rounded-lg bg-surface-container-low px-2 py-2 text-sm"
            disabled={filters.period !== "custom"}
          />
          <input
            type="date"
            value={filters.endDate}
            onChange={(e) => onFilterChange("endDate", e.target.value)}
            className="rounded-lg bg-surface-container-low px-2 py-2 text-sm"
            disabled={filters.period !== "custom"}
          />
          <select
            value={filters.coin}
            onChange={(e) => onFilterChange("coin", e.target.value)}
            className="rounded-lg bg-surface-container-low px-2 py-2 text-sm"
          >
            <option value="all">Tum Coinler</option>
            {(data?.filterOptions.coins ?? []).map((coin) => (
              <option key={coin} value={coin}>
                {coin}
              </option>
            ))}
          </select>
          <select
            value={filters.aiModel}
            onChange={(e) => onFilterChange("aiModel", e.target.value)}
            className="rounded-lg bg-surface-container-low px-2 py-2 text-sm"
          >
            <option value="all">Tum AI Modelleri</option>
            {(data?.filterOptions.aiModels ?? []).map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
          <select
            value={filters.mode}
            onChange={(e) => onFilterChange("mode", e.target.value)}
            className="rounded-lg bg-surface-container-low px-2 py-2 text-sm"
          >
            <option value="all">Tum Islem Tipleri</option>
            <option value="manual">Manuel</option>
            <option value="auto">Otomatik</option>
          </select>
          <div className="rounded-lg border border-outline-variant/20 bg-surface-container-low px-2 py-2 text-xs">
            {data ? (
              <span>
                {new Date(data.filters.rangeStart).toLocaleDateString("tr-TR")} -{" "}
                {new Date(data.filters.rangeEnd).toLocaleDateString("tr-TR")}
              </span>
            ) : (
              <span>Aralik hazirlaniyor</span>
            )}
          </div>
        </div>
      </Panel>

      {error ? <Panel title="Hata">{error}</Panel> : null}
      {loading && !data ? <Panel title="Yukleniyor">Rapor getiriliyor...</Panel> : null}

      {data ? (
        <>
          <section className="grid grid-cols-2 gap-3 xl:grid-cols-6">
            {[
              { label: "Toplam Kar", value: currency(data.summary.totalProfit), positive: true },
              { label: "Toplam Zarar", value: currency(data.summary.totalLoss), positive: false },
              { label: "Net PnL", value: currency(data.summary.netPnl), positive: data.summary.netPnl >= 0 },
              { label: "Toplam Islem", value: String(data.summary.tradeCount), positive: true },
              { label: "Kazanma Orani", value: `${data.summary.winRate.toFixed(2)}%`, positive: data.summary.winRate >= 50 },
              { label: "Toplam Komisyon", value: data.summary.totalFee.toFixed(6), positive: false },
              { label: "Realized PnL", value: currency(data.summary.realizedPnl), positive: data.summary.realizedPnl >= 0 },
              { label: "Unrealized PnL", value: currency(data.summary.unrealizedPnl), positive: data.summary.unrealizedPnl >= 0 },
              { label: "Basarili Islem", value: String(data.summary.successCount), positive: true },
              { label: "Basarisiz Islem", value: String(data.summary.failedCount), positive: false },
              { label: "En Karli Coin", value: data.summary.bestCoin ?? "-", positive: true },
              { label: "En Zararli Coin", value: data.summary.worstCoin ?? "-", positive: false },
            ].map((card) => (
              <Panel key={card.label} title={card.label}>
                <p className={`text-xl font-black ${card.positive ? "text-secondary" : "text-tertiary"}`}>{card.value}</p>
              </Panel>
            ))}
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel title="Zaman Bazli Net PnL">
              <div className="space-y-1">
                {data.charts.netPnlTimeline.slice(-14).map((row) => (
                  <div key={row.date} className="flex items-center gap-2 text-xs">
                    <span className="w-24 text-on-surface-variant">{row.date}</span>
                    <span className={`w-20 font-semibold ${row.netPnl >= 0 ? "text-secondary" : "text-tertiary"}`}>{currency(row.netPnl)}</span>
                    <span className="text-on-surface-variant">Kumulatif: {currency(row.cumulative)}</span>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="Coin Bazli Kar Dagilimi">
              <div className="space-y-2">
                {data.charts.coinPnlDistribution.slice(0, 10).map((row) => (
                  <div key={row.label} className="text-xs">
                    <div className="mb-1 flex items-center justify-between">
                      <span>{row.label}</span>
                      <span className={row.value >= 0 ? "text-secondary" : "text-tertiary"}>{currency(row.value)}</span>
                    </div>
                    <div className="h-2 rounded bg-surface-container-high">
                      <div
                        className={`h-2 rounded ${row.value >= 0 ? "bg-secondary" : "bg-tertiary"}`}
                        style={{ width: barWidth(row.value, maxCoinAbs) }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="AI Bazli Performans Karsilastirmasi">
              <div className="space-y-2">
                {data.charts.aiPerformanceComparison.slice(0, 10).map((row) => (
                  <div key={row.label} className="text-xs">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="truncate">{row.label}</span>
                      <span className={row.value >= 0 ? "text-secondary" : "text-tertiary"}>{currency(row.value)}</span>
                    </div>
                    <div className="h-2 rounded bg-surface-container-high">
                      <div
                        className={`h-2 rounded ${row.value >= 0 ? "bg-secondary" : "bg-tertiary"}`}
                        style={{ width: barWidth(row.value, maxAiAbs) }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="Analiz Ozetleri">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <article className="rounded-lg bg-surface-container-low p-2">
                  <p className="text-on-surface-variant">Maks Drawdown</p>
                  <p className="font-black text-tertiary">{data.analysis.maxDrawdown.toFixed(6)}</p>
                </article>
                <article className="rounded-lg bg-surface-container-low p-2">
                  <p className="text-on-surface-variant">Maks Kazanc Serisi</p>
                  <p className="font-black text-secondary">{data.analysis.streaks.maxWinStreak}</p>
                </article>
                <article className="rounded-lg bg-surface-container-low p-2">
                  <p className="text-on-surface-variant">Maks Kayip Serisi</p>
                  <p className="font-black text-tertiary">{data.analysis.streaks.maxLossStreak}</p>
                </article>
                <article className="rounded-lg bg-surface-container-low p-2">
                  <p className="text-on-surface-variant">Acik Pozisyon</p>
                  <p className="font-black">{data.summary.openCount}</p>
                </article>
              </div>
              <div className="mt-3 space-y-1 text-xs">
                <p className="font-semibold">Saat Bazli Basari</p>
                {data.analysis.hourlySuccessRate.slice(0, 8).map((row) => (
                  <p key={row.hour} className="text-on-surface-variant">
                    {row.hour}:00 - %{row.winRate.toFixed(1)} ({row.tradeCount} islem)
                  </p>
                ))}
              </div>
            </Panel>
          </section>

          <Panel title="Detayli Islem Tablosu">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1400px] text-xs">
                <thead className="text-on-surface-variant">
                  <tr className="border-b border-outline-variant/20">
                    <th className="py-2 text-left">Coin</th>
                    <th className="py-2 text-left">Alis Zamani</th>
                    <th className="py-2 text-right">Alis Fiyat</th>
                    <th className="py-2 text-right">Alis Miktar</th>
                    <th className="py-2 text-left">Satis Zamani</th>
                    <th className="py-2 text-right">Satis Fiyat</th>
                    <th className="py-2 text-right">Satis Miktar</th>
                    <th className="py-2 text-right">Komisyon</th>
                    <th className="py-2 text-right">Net PnL</th>
                    <th className="py-2 text-right">Sure</th>
                    <th className="py-2 text-left">AI Model</th>
                    <th className="py-2 text-left">Tip</th>
                    <th className="py-2 text-left">Sonuc</th>
                    <th className="py-2 text-left">Uyari</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.id} className="border-b border-outline-variant/10">
                      <td className="py-2 font-semibold">{row.coin}</td>
                      <td className="py-2">{row.buyTime ? new Date(row.buyTime).toLocaleString("tr-TR") : "-"}</td>
                      <td className="py-2 text-right">{row.buyPrice.toFixed(8)}</td>
                      <td className="py-2 text-right">{row.buyQty.toFixed(8)}</td>
                      <td className="py-2">{row.sellTime ? new Date(row.sellTime).toLocaleString("tr-TR") : "-"}</td>
                      <td className="py-2 text-right">{row.sellPrice.toFixed(8)}</td>
                      <td className="py-2 text-right">{row.sellQty.toFixed(8)}</td>
                      <td className="py-2 text-right">{row.fee.toFixed(8)}</td>
                      <td className={`py-2 text-right font-bold ${row.netPnl >= 0 ? "text-secondary" : "text-tertiary"}`}>{currency(row.netPnl)}</td>
                      <td className="py-2 text-right">{row.durationSec}s</td>
                      <td className="py-2">{row.aiModel}</td>
                      <td className="py-2 uppercase">{row.tradeType}</td>
                      <td className="py-2 uppercase">{row.result}</td>
                      <td className="py-2 text-tertiary">{row.warnings.join(", ") || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      ) : null}
    </div>
  );
}
