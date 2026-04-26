"use client";

import Link from "next/link";
import { useI18n } from "@/src/i18n/provider";

export default function Home() {
  const { t, locale, locales, setLocale, localeLabels } = useI18n();

  return (
    <div className="min-h-screen bg-background text-on-surface flex items-center justify-center p-8">
      <main className="w-full max-w-xl glass-panel rounded-2xl p-8 space-y-6">
        <div className="flex justify-end">
          <div className="flex items-center gap-1 rounded-md border border-outline-variant/30 bg-surface-container-low px-1 py-1">
            {locales.map((code) => (
              <button
                key={code}
                onClick={() => setLocale(code)}
                className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                  locale === code ? "bg-primary text-[#002e6a]" : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                {localeLabels[code]}
              </button>
            ))}
          </div>
        </div>
        <h1 className="text-4xl font-black tracking-tight text-primary">KINETIC</h1>
        <p className="text-on-surface-variant">
          {t("home.description")}
        </p>
        <div className="flex gap-3">
          <Link
            href="/login"
            className="px-5 py-2.5 rounded-lg bg-surface-container-low hover:bg-surface-container transition-colors font-bold"
          >
            {t("home.login")}
          </Link>
          <Link
            href="/dashboard"
            className="px-5 py-2.5 rounded-lg bg-linear-to-br from-primary to-primary-container text-[#002e6a] font-bold"
          >
            {t("nav.dashboard")}
          </Link>
        </div>
      </main>
    </div>
  );
}
