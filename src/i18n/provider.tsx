"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { localeLabels, localeTags, messages, type Locale, type TranslationKey } from "@/src/i18n/messages";

type I18nContextValue = {
  locale: Locale;
  localeTag: string;
  locales: Locale[];
  localeLabels: Record<Locale, string>;
  setLocale: (next: Locale) => void;
  t: (key: TranslationKey) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function pickInitialLocale(): Locale {
  if (typeof window === "undefined") return "tr";
  const stored = window.localStorage.getItem("kinetic.locale");
  if (stored === "tr" || stored === "en") return stored;
  return window.navigator.language.toLowerCase().startsWith("tr") ? "tr" : "en";
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => pickInitialLocale());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("kinetic.locale", next);
      document.documentElement.lang = next;
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const t = useCallback(
    (key: TranslationKey) => {
      return messages[locale][key] ?? messages.tr[key] ?? key;
    },
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      localeTag: localeTags[locale],
      locales: ["tr", "en"],
      localeLabels,
      setLocale,
      t,
    }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return ctx;
}
