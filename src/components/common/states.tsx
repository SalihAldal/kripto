"use client";

import { useI18n } from "@/src/i18n/provider";

export function SkeletonBlock({ className = "h-20" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-surface-container-low ${className}`} />;
}

export function EmptyState({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-lg border border-outline-variant/20 bg-surface-container-low p-4 text-center">
      <p className="font-bold">{title}</p>
      <p className="mt-1 text-xs text-on-surface-variant">{desc}</p>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useI18n();

  return (
    <div className="rounded-lg border border-tertiary/30 bg-tertiary/10 p-4">
      <p className="font-bold text-tertiary">{t("state.error")}</p>
      <p className="mt-1 text-xs text-tertiary">{message}</p>
      {onRetry ? (
        <button
          onClick={onRetry}
          className="mt-3 rounded-lg bg-surface-container px-3 py-1.5 text-xs font-bold hover:bg-surface-container-high"
        >
          {t("state.retry")}
        </button>
      ) : null}
    </div>
  );
}
