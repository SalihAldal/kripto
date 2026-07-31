"use client";

import { Panel } from "@/src/components/common/panel";
import { SkeletonBlock } from "@/src/components/common/states";
import { useI18n } from "@/src/i18n/provider";
import type { SummaryCard } from "@/src/types/platform";

export function SummaryCards({ items, loading }: { items: SummaryCard[]; loading: boolean }) {
  const { t } = useI18n();

  const labelByKey: Record<string, string> = {
    system: t("summary.system"),
    models: t("summary.models"),
    open: t("summary.open"),
    pnl: t("summary.pnl"),
  };

  const valueByStatus: Record<string, string> = {
    OPERATIONAL: t("status.operational"),
    PAUSED: t("status.paused"),
    DEGRADED: t("status.degraded"),
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, idx) => (
          <SkeletonBlock key={idx} className="h-28" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {items.map((item) => (
        <Panel key={item.key}>
          <p className="text-xs uppercase tracking-widest text-on-surface-variant">{labelByKey[item.key] ?? item.label}</p>
          <p
            className={`mt-2 text-2xl font-black ${
              item.tone === "secondary"
                ? "text-secondary"
                : item.tone === "tertiary"
                  ? "text-tertiary"
                  : "text-on-surface"
            }`}
          >
            {valueByStatus[item.value] ?? item.value}
          </p>
          {item.delta ? <p className="mt-1 text-xs text-on-surface-variant">{item.delta}</p> : null}
        </Panel>
      ))}
    </div>
  );
}
