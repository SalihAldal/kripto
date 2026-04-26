"use client";

import type { ReactNode } from "react";
import { Sidebar } from "@/src/features/shell/sidebar";
import { Topbar } from "@/src/features/shell/topbar";
import { shellNavItems } from "@/src/features/shell/nav-items";
import Link from "next/link";
import { useI18n } from "@/src/i18n/provider";

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();

  return (
    <div className="min-h-screen bg-background text-on-surface">
      <Topbar />
      <div className="md:hidden border-b border-outline-variant/20 bg-surface-container-low/70 backdrop-blur px-3 py-2 overflow-x-auto scroll-slim">
        <nav className="flex gap-2 min-w-max">
          {shellNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg bg-surface-container px-3 py-1.5 text-xs font-bold text-on-surface-variant hover:text-on-surface"
            >
              {t(item.key)}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex">
        <Sidebar />
        <main className="flex-1 p-4 md:p-6 overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}
