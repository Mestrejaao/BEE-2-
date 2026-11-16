import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const configUrl = new URL("../docs/bee-config.js", import.meta.url);
const configSource = await readFile(configUrl, "utf8");
const docsHtml = await readFile(new URL("../docs/index.html", import.meta.url), "utf8");
const frontendHtml = await readFile(new URL("../frontend/index.html", import.meta.url), "utf8");

test("central frontend config defines an empty API base until the Worker URL is supplied", () => {
  const window = {};
  vm.runInNewContext(configSource, { window });
  assert.equal(window.BEE_API_BASE, "");
});

test("central frontend config preserves the configured Worker URL", () => {
  const window = { BEE_API_BASE: "https://bee-api.example.workers.dev" };
  vm.runInNewContext(configSource, { window });
  assert.equal(window.BEE_API_BASE, "https://bee-api.example.workers.dev");
});

test("GitHub Pages loads the centralized config before the app script", () => {
  assert.match(docsHtml, /<script src="\.\/bee-config\.js"><\/script>\s*<script>/);
  assert.match(docsHtml, /window\.BEE_API_BASE em docs\/bee-config\.js/);
});

test("frontend entry point redirects to the canonical docs interface instead of duplicating it", () => {
  assert.match(frontendHtml, /url=\.\.\/docs\//);
  assert.doesNotMatch(frontendHtml, /var API_BASE|function askAI/);
});
