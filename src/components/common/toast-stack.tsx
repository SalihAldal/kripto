"use client";

import type { ToastItem } from "@/src/lib/use-toast";

export function ToastStack({ items }: { items: ToastItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="fixed right-4 top-4 z-50 space-y-2">
      {items.map((item) => (
        <div
          key={item.id}
          className={`min-w-[240px] rounded-lg border px-3 py-2 text-sm shadow-lg ${
            item.tone === "success"
              ? "border-secondary/40 bg-secondary/10 text-secondary"
              : item.tone === "error"
                ? "border-tertiary/40 bg-tertiary/10 text-tertiary"
                : "border-primary/40 bg-primary/10 text-primary"
          }`}
        >
          {item.message}
        </div>
      ))}
    </div>
  );
}
