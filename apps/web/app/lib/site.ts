export function getSiteUrl() {
  const configured = process.env.APP_BASE_URL || "https://llmweb.szlk.ai";
  try {
    return new URL(configured);
  } catch {
    return new URL("https://llmweb.szlk.ai");
  }
}
