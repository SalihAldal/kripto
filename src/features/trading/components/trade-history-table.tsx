"use client";

import { Panel } from "@/src/components/common/panel";
import { EmptyState } from "@/src/components/common/states";
import { useI18n } from "@/src/i18n/provider";
import type { TradeHistoryRow } from "@/src/types/platform";

export function TradeHistoryTable({ rows }: { rows: TradeHistoryRow[] }) {
  const { t } = useI18n();

  return (
    <Panel title={t("tradeHistory.tableTitle")}>
      {rows.length === 0 ? (
        <EmptyState title={t("tradeHistory.emptyTitle")} desc={t("tradeHistory.emptyDesc")} />
      ) : (
        <div className="overflow-x-auto scroll-slim">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-xs uppercase text-on-surface-variant">
              <tr>
                <th className="text-left py-2">{t("tradeHistory.timestamp")}</th>
                <th className="text-left py-2">{t("tradeHistory.asset")}</th>
                <th className="text-right py-2">{t("tradeHistory.side")}</th>
                <th className="text-right py-2">{t("tradeHistory.entryExit")}</th>
                <th className="text-right py-2">{t("tradeHistory.duration")}</th>
                <th className="text-right py-2">{t("tradeHistory.pnl")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-outline-variant/15">
                  <td className="py-3 font-mono text-xs">{row.time}</td>
                  <td className="py-3 font-bold">{row.symbol}</td>
                  <td className={`py-3 text-right font-bold ${row.side === "LONG" ? "text-secondary" : "text-tertiary"}`}>
                    {row.side}
                  </td>
                  <td className="py-3 text-right">
                    {row.entry.toFixed(2)} / {row.exit.toFixed(2)}
                  </td>
                  <td className="py-3 text-right text-on-surface-variant">{row.duration}</td>
                  <td className={`py-3 text-right font-bold ${row.pnl >= 0 ? "text-secondary" : "text-tertiary"}`}>
                    {row.pnlPercent.toFixed(2)}% ({row.pnl.toFixed(2)})
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
