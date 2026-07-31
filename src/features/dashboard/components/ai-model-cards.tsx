"use client";

import { Panel } from "@/src/components/common/panel";
import { EmptyState, ErrorState, SkeletonBlock } from "@/src/components/common/states";
import { useI18n } from "@/src/i18n/provider";
import type { AIModelCard } from "@/src/types/platform";

type Props = {
  items: AIModelCard[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
};

export function AIModelCards({ items, loading, error, onRetry }: Props) {
  const { t } = useI18n();

  return (
    <Panel title={t("aiCards.title")}>
      {loading ? (
        <div className="grid md:grid-cols-3 gap-3">
          <SkeletonBlock className="h-32" />
          <SkeletonBlock className="h-32" />
          <SkeletonBlock className="h-32" />
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : items.length === 0 ? (
        <EmptyState title={t("aiCards.emptyTitle")} desc={t("aiCards.emptyDesc")} />
      ) : (
        <div className="grid md:grid-cols-3 gap-3">
          {items.map((item) => (
            <div key={item.id} className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-4">
              <p className="text-xs uppercase tracking-widest text-on-surface-variant">{item.model}</p>
              <p className="mt-2 text-xl font-black">{item.signal}</p>
              <p className="mt-1 text-sm text-secondary">{(item.confidence * 100).toFixed(1)}%</p>
              <p className="mt-2 text-xs text-on-surface-variant">{item.reason}</p>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
