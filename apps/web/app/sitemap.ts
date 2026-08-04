import type { MetadataRoute } from "next";
import { getSiteUrl } from "./lib/site";

const publicPaths = ["/", "/terms", "/privacy", "/cookie-policy", "/refund-policy", "/data-rights", "/do-not-sell", "/ai-disclaimer", "/legal-supplement"];

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getSiteUrl();
  return publicPaths.map((path) => ({
    url: new URL(path, siteUrl).toString(),
    lastModified: new Date("2026-08-04T00:00:00Z"),
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : 0.3,
  }));
}
