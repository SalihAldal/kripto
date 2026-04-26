"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { shellNavItems } from "@/src/features/shell/nav-items";
import { useI18n } from "@/src/i18n/provider";

export function Sidebar() {
  const pathname = usePathname();
  const { t } = useI18n();

  return (
    <aside className="hidden md:flex w-64 bg-surface-container-low border-r border-outline-variant/20 min-h-[calc(100vh-4rem)] p-4">
      <nav className="w-full space-y-1">
        {shellNavItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-xl px-4 py-3 text-sm transition-all ${
                active
                  ? "bg-surface-container text-primary border-r-2 border-primary-container font-bold"
                  : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
              }`}
            >
              {t(item.key)}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
