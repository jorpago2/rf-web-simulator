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
