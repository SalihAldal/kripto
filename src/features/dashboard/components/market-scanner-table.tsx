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
                  <td className="py-3 font-bold">{row.symbol}</td>
                  <td className="py-3 text-right">{row.price.toFixed(2)}</td>
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
