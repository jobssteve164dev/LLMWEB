export const supportedLocales = ["zh-CN", "en"] as const;
export type Locale = (typeof supportedLocales)[number];

export const localeCookieName = "llmweb_locale";

export function normalizeLocale(value: string | null | undefined): Locale {
  if (!value) return "zh-CN";
  return value?.trim().toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function localeTag(locale: Locale) {
  return locale === "zh-CN" ? "zh-CN" : "en-US";
}
