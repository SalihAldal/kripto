"use client";

import { Panel } from "@/src/components/common/panel";
import { EmptyState } from "@/src/components/common/states";
import { useI18n } from "@/src/i18n/provider";
import type { NotificationItem } from "@/src/types/platform";

const levelStyles: Record<NotificationItem["level"], string> = {
  info: "border-primary/30 text-primary",
  success: "border-secondary/30 text-secondary",
  warning: "border-tertiary/30 text-tertiary",
  error: "border-tertiary/40 text-tertiary",
};

export function NotificationsPanel({ items }: { items: NotificationItem[] }) {
  const { t } = useI18n();

  return (
    <Panel title={t("notifications.title")}>
      {items.length === 0 ? (
        <EmptyState title={t("notifications.emptyTitle")} desc={t("notifications.emptyDesc")} />
      ) : (
        <div className="space-y-2">
          {items.map((item, idx) => (
            <article key={`${item.id}-${item.time}-${idx}`} className={`rounded-lg border bg-surface-container-low p-3 ${levelStyles[item.level]}`}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold">{item.title}</p>
                <span className="text-[10px] text-on-surface-variant">{item.time}</span>
              </div>
              <p className="mt-1 text-xs text-on-surface-variant">{item.description}</p>
            </article>
          ))}
        </div>
      )}
    </Panel>
  );
}
