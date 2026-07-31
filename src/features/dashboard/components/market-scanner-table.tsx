"use client";

import { Panel } from "@/src/components/common/panel";
import { EmptyState, ErrorState, SkeletonBlock } from "@/src/components/common/states";
import { useI18n } from "@/src/i18n/provider";
import type { ScannerRow } from "@/src/types/platform";

type Props = {
  rows: ScannerRow[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
};

export function MarketScannerTable({ rows, loading, error, onRetry }: Props) {
  const { t } = useI18n();
  const sentimentTone = (value?: number, label?: string) => {
    if (label === "POSITIVE" || (value ?? 50) >= 65) return "text-secondary border-secondary/30 bg-secondary/10";
    if (label === "NEGATIVE" || (value ?? 50) <= 35) return "text-tertiary border-tertiary/30 bg-tertiary/10";
    return "text-on-surface-variant border-outline-variant/30 bg-surface-container-low";
  };

  return (
    <Panel title={t("scanner.title")}>
      {loading ? (
        <div className="space-y-2">
          <SkeletonBlock className="h-10" />
          <SkeletonBlock className="h-10" />
          <SkeletonBlock className="h-10" />
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : rows.length === 0 ? (
        <EmptyState title={t("scanner.emptyTitle")} desc={t("scanner.emptyDesc")} />
      ) : (
        <div className="overflow-x-auto scroll-slim">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="text-xs uppercase text-on-surface-variant">
              <tr>
                <th className="text-left py-2">{t("scanner.asset")}</th>
                <th className="text-right py-2">{t("scanner.price")}</th>
                <th className="text-right py-2">{t("scanner.change24h")}</th>
                <th className="text-right py-2">{t("scanner.volume")}</th>
                <th className="text-right py-2">{t("scanner.aiScore")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.symbol} className="border-t border-outline-variant/15">
                  <td className="py-3 font-bold">
                    <div className="flex flex-col gap-1">
                      <span>{row.symbol}</span>
                      <div className="flex flex-wrap gap-1 text-[10px] font-semibold">
                        {Number(row.pumpIntensity ?? 0) >= 70 || Number(row.volumeSpikePercent ?? 0) >= 120 ? (
                          <span className="rounded border border-primary/30 bg-primary/10 px-2 py-0.5 text-primary">
                            Pump {Number(row.pumpIntensity ?? 0).toFixed(0)}
                          </span>
                        ) : null}
                        <span
                          className={`rounded border px-2 py-0.5 ${sentimentTone(
                            row.socialSentimentScore,
                            row.newsSentiment,
                          )}`}
                        >
                          Sentiment {Number(row.socialSentimentScore ?? 50).toFixed(0)}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 text-right">{row.price.toFixed(6)}</td>
                  <td className={`py-3 text-right ${row.change24h >= 0 ? "text-secondary" : "text-tertiary"}`}>
                    {row.change24h.toFixed(2)}%
                  </td>
                  <td className="py-3 text-right">{Math.round(row.volume24h).toLocaleString()}</td>
                  <td className="py-3 text-right font-bold text-primary">{row.aiScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
