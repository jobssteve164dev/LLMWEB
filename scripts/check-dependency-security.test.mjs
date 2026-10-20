import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const configRequire = createRequire(webRequire.resolve("eslint-config-next"));
const pluginRequire = createRequire(configRequire.resolve("@next/eslint-plugin-next"));
const globRequire = createRequire(pluginRequire.resolve("fast-glob"));
const matchRequire = createRequire(globRequire.resolve("micromatch"));
const braces = matchRequire("braces");
const glob = pluginRequire("fast-glob");

for (const [open, close] of [["{", "}"], ["(", ")"], ["{(", ")}"]]) {
  const depth = open.length === 1 ? 4995 : 2495;
  const pattern = open.repeat(depth) + "a,b" + close.repeat(depth);
  for (const method of ["compile", "expand", "stringify"]) {
    test(`${method} handles deep ${open}${close} without stack exhaustion`, () => {
      assert.doesNotThrow(() => braces[method](pattern));
    });
  }
  test(`unclosed deep ${open} remains safe`, () => {
    assert.doesNotThrow(() => braces.compile(open.repeat(depth) + "a,b"));
    assert.doesNotThrow(() => braces.expand(open.repeat(depth) + "a,b"));
  });
}

test("ordinary nested patterns keep their expansion and range semantics", () => {
  assert.deepEqual(braces.expand("a{b,{c,{d,e}}}f"), ["abf", "acf", "adf", "aef"]);
  assert.deepEqual(braces.expand("{01..03}"), ["01", "02", "03"]);
  assert.deepEqual(braces.expand(String.raw`a\{b,c\}`), ["a{b,c}"]);
});

test("bounded nesting preserves quoting, escapes and delimiter types", () => {
  for (const [pattern, expected] of [
    ["{{a,b},c}", ["{a,b}", "c"]],
    [String.raw`{{a,\}b},c}`, [String.raw`{a,\}b}`, "c"]],
    ["{{a),b},c}", ["{a),b}", "c"]],
    ["{(a},b),c}", ["(a},b)", "c"]],
    ["{{[}],a},b}", ["{[}],a}", "b"]],
    ['{{a,"}"},b}', ['{a,"}"}', "b"]],
    ["{{a(,b},c}", ["{{a(,b},c}"]],
  ]) {
    assert.deepEqual(braces.expand(pattern, { maxDepth: 1 }), expected);
  }
});

test("callers cannot raise the nesting safety ceiling", () => {
  const pattern = "{".repeat(4995) + "a,b" + "}".repeat(4995);
  for (const maxDepth of [Infinity, 10000, NaN, -1, "1"]) {
    assert.doesNotThrow(() => braces.expand(pattern, { maxDepth }));
  }
});

test("Next ESLint's actual glob consumer still finds application routes", () => {
  assert.deepEqual(glob.sync("app/{page,layout}.tsx", {
    cwd: new URL("../apps/web/", import.meta.url).pathname,
  }).sort(), ["app/layout.tsx", "app/page.tsx"]);
});
