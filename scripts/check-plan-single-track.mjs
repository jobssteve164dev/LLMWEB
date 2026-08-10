import { readFile } from "node:fs/promises";

const guarded = [
  "apps/web/app/lib/passport.ts",
  "apps/web/app/components/workbench.tsx",
  "apps/web/app/page.tsx",
  "services/control-plane/src/llmweb_control/main.py",
  "services/control-plane/src/llmweb_control/security.py",
  "README.md",
  "docs/product/product-design.md",
  "docs/architecture/system-boundaries.md",
];
const forbidden = [
  [/limit\s*===\s*10/, "paid tier inferred from a local quota"],
  [/limit\s*===\s*2/, "free tier inferred from a local quota"],
  [/免费(?:用户|账号|版).*2\s*个项目/, "hard-coded public free quota"],
  [/付费(?:用户|账号|版).*10\s*个项目/, "hard-coded public paid quota"],
  [/using the free project limit/, "local quota fallback"],
];
const failures = [];
for (const file of guarded) {
  const content = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  for (const [pattern, reason] of forbidden) if (pattern.test(content)) failures.push(`${file}: ${reason}`);
}
if (failures.length) throw new Error(`LLMWEB plan single-track guard failed:\n${failures.join("\n")}`);
console.log(`LLMWEB plan single-track guard passed (${guarded.length} files)`);
