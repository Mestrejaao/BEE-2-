import test from "node:test";
import assert from "node:assert/strict";
import { chooseProvider, getProviderOrder } from "../src/router/selector.js";

test("selects OpenAI for a short, ordinary prompt", () => {
  assert.equal(chooseProvider([{ role: "user", content: "Oi, tudo bem?" }]), "openai");
});

test("selects Anthropic for prompts that signal deeper analysis", () => {
  assert.equal(chooseProvider([{ role: "user", content: "Faça uma análise detalhada deste plano." }]), "anthropic");
});

test("prefers the selected provider and falls back to the configured alternative", () => {
  assert.deepEqual(
    getProviderOrder("anthropic", { OPENAI_API_KEY: "x", ANTHROPIC_API_KEY: "y" }),
    ["anthropic", "openai"]
  );
});

test("uses the available provider when the preferred one is not configured", () => {
  assert.deepEqual(
    getProviderOrder("anthropic", { OPENAI_API_KEY: "x" }),
    ["openai"]
  );
});
