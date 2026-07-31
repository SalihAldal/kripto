"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navItems } from "@/components/layout/nav-items";

export function PlatformShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-background text-on-surface">
      <header className="h-16 border-b border-outline-variant/20 bg-[#101419]/80 backdrop-blur-xl flex items-center justify-between px-6 sticky top-0 z-50">
        <div className="flex items-center gap-8">
          <span className="text-xl font-black tracking-tighter text-primary">KINETIC</span>
          <div className="hidden md:flex gap-5 text-sm text-on-surface-variant">
            <span>BTC/USDT</span>
            <span>ETH/USDT</span>
            <span>SOL/USDT</span>
          </div>
        </div>
        <div className="text-xs text-secondary font-bold">AI ENGINE ACTIVE</div>
      </header>

      <div className="flex">
        <aside className="hidden md:flex w-64 border-r border-outline-variant/20 bg-surface-container-low min-h-[calc(100vh-4rem)] p-4">
          <nav className="w-full space-y-1">
            {navItems.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block px-4 py-3 rounded-xl transition-all ${
                    active
                      ? "bg-surface-container text-primary border-r-2 border-primary-container"
                      : "text-on-surface-variant hover:bg-surface-container"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
