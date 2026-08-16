import "server-only";

import { cookies, headers } from "next/headers";
import { localeCookieName, normalizeLocale, type Locale } from "./i18n";

export async function getRequestLocale(): Promise<Locale> {
  const cookieLocale = (await cookies()).get(localeCookieName)?.value;
  if (cookieLocale) return normalizeLocale(cookieLocale);
  return normalizeLocale((await headers()).get("accept-language"));
}

