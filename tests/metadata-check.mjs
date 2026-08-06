import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("publishes complete social and browser metadata", async () => {
  const html = await readFile(new globalThis.URL("../index.html", import.meta.url), "utf8");
  await access(new globalThis.URL("../public/favicon.svg", import.meta.url));
  for (const metadata of ["theme-color", "canonical", "favicon.svg", "og:site_name", "og:title", "og:description", "og:type", "og:url", "twitter:card", "twitter:title", "twitter:description"]) {
    assert.match(html, new RegExp(metadata));
  }
});

test("starts with an empty RF workbench and reveals advanced analysis on demand", async () => {
  const store = await readFile(new globalThis.URL("../src/app/store.ts", import.meta.url), "utf8");
  const app = await readFile(new globalThis.URL("../src/app/App.tsx", import.meta.url), "utf8");
  const components = await readFile(new globalThis.URL("../src/components.tsx", import.meta.url), "utf8");
  assert.match(store, /nodes: \[\],[\s\S]*edges: \[\],/);
  assert.match(app, /Start with a block/);
  assert.match(components, /<summary>Advanced analysis<\/summary>/);
  assert.match(components, /\{result && <div[\s\S]*className="results-tabs"/);
});

test("uses semantic Tailwind utilities without Preflight", async () => {
  const styles = await readFile(new globalThis.URL("../src/index.css", import.meta.url), "utf8");
  const app = await readFile(new globalThis.URL("../src/app/App.tsx", import.meta.url), "utf8");
  assert.match(styles, /tailwindcss\/theme\.css/);
  assert.match(styles, /tailwindcss\/utilities\.css/);
  assert.match(styles, /@theme inline/);
  assert.doesNotMatch(styles, /tailwindcss\/preflight|@import\s+["']tailwindcss["']/);
  assert.match(app, /bg-ui-surface/);
});
