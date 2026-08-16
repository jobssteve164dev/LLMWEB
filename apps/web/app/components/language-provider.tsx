"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { localeCookieName, type Locale } from "../lib/i18n";

type LanguageContextValue = { locale: Locale; setLocale: (locale: Locale) => void };
const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ initialLocale, children }: { initialLocale: Locale; children: React.ReactNode }) {
  const router = useRouter();
  const [locale, setCurrentLocale] = useState(initialLocale);
  const value = useMemo<LanguageContextValue>(() => ({
    locale,
    setLocale(nextLocale) {
      setCurrentLocale(nextLocale);
      document.documentElement.lang = nextLocale;
      document.cookie = `${localeCookieName}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
      router.refresh();
    },
  }), [locale, router]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("useLanguage must be used inside LanguageProvider");
  return value;
}

export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale } = useLanguage();
  const nextLocale = locale === "zh-CN" ? "en" : "zh-CN";
  return <button className={className ? `languageSwitcher ${className}` : "languageSwitcher"} type="button" onClick={() => setLocale(nextLocale)} aria-label={locale === "zh-CN" ? "Switch to English" : "切换到中文"}>{locale === "zh-CN" ? "EN" : "中文"}</button>;
}

