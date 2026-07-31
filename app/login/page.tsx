"use client";

import Link from "next/link";
import { useI18n } from "@/src/i18n/provider";

export default function LoginPage() {
  const { t, locale, locales, setLocale, localeLabels } = useI18n();

  return (
    <div className="min-h-screen bg-[#0B0F14] text-on-surface flex items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary/5 blur-[120px]" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[30%] rounded-full bg-secondary/5 blur-[100px]" />

      <main className="w-full max-w-[480px] z-10">
        <div className="mb-4 flex justify-end">
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
        <div className="text-center mb-10">
          <h1 className="text-3xl font-black tracking-tighter text-primary mb-2">KINETIC</h1>
          <p className="text-on-surface-variant font-medium tracking-wide text-sm uppercase">
            {t("login.subtitle")}
          </p>
        </div>

        <div className="glass-panel rounded-xl p-8 md:p-12 space-y-6">
          <div>
            <h2 className="text-xl font-bold tracking-tight">{t("login.systemAccess")}</h2>
            <p className="text-sm text-on-surface-variant mt-1">
              {t("login.accessDesc")}
            </p>
          </div>

          <div className="space-y-4">
            <input
              className="w-full bg-surface-container-low rounded-lg px-4 py-3 border border-outline-variant/20"
              placeholder={t("login.idPlaceholder")}
            />
            <input
              className="w-full bg-surface-container-low rounded-lg px-4 py-3 border border-outline-variant/20"
              placeholder={t("login.passwordPlaceholder")}
              type="password"
            />
            <Link
              href="/dashboard"
              className="block w-full text-center py-3 rounded-lg bg-linear-to-br from-primary to-primary-container text-[#002e6a] font-black"
            >
              {t("login.initializeSession")}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
