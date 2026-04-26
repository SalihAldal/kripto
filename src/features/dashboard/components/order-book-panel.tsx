"use client";

import { Panel } from "@/src/components/common/panel";
import { EmptyState } from "@/src/components/common/states";
import { useI18n } from "@/src/i18n/provider";
import type { OrderBookRow } from "@/src/types/platform";

function toNumber(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function OrderBookPanel({ rows }: { rows: OrderBookRow[] }) {
  const { t } = useI18n();

  return (
    <Panel title={t("orderBook.title")}>
      {rows.length === 0 ? (
        <EmptyState title={t("orderBook.emptyTitle")} desc={t("orderBook.emptyDesc")} />
      ) : (
        <div className="space-y-1 text-xs font-mono">
          {rows.map((row, idx) => {
            const price = toNumber(row.price);
            const amount = toNumber(row.amount);
            const total = toNumber(row.total);
            return (
              <div
                key={`${row.side}-${idx}`}
                className={`grid grid-cols-3 rounded px-2 py-1.5 ${
                  row.side === "bid" ? "bg-secondary/10 text-secondary" : "bg-tertiary/10 text-tertiary"
                }`}
              >
                <span>{price.toFixed(2)}</span>
                <span>{amount.toFixed(3)}</span>
                <span className="text-right">{Math.round(total).toLocaleString()}</span>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
