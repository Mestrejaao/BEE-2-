import test from "node:test";
import assert from "node:assert/strict";
import { askOpenAI } from "../src/providers/openai.js";
import { askAnthropic } from "../src/providers/anthropic.js";
import { askGemini, toGeminiContents, toGeminiSystemInstruction } from "../src/providers/gemini.js";
import worker from "../src/index.js";
import { createSession } from "../src/security/session.js";

const OPENAI_ENV = { OPENAI_API_KEY: "mock-openai-key" };
const ANTHROPIC_ENV = { ANTHROPIC_API_KEY: "mock-anthropic-key" };
const GEMINI_ENV = { GEMINI_API_KEY: "mock-gemini-key" };
const SESSION_SECRET = "unit-test-session-secret-with-at-least-32-characters";
const messages = [{ role: "user", content: "Olá, BEE!" }];

async function withMockFetch(mock, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock;
  try { return await run(); } finally { globalThis.fetch = originalFetch; }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json" }
  });
}

test("OpenAI adapter returns text from a valid Responses API payload", async () => {
  await withMockFetch(async (url, options) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    assert.equal(options.headers.Authorization, "Bearer mock-openai-key");
    return jsonResponse({ output: [{ type: "message", content: [{ type: "output_text", text: "Resposta simulada da OpenAI." }] }] });
  }, async () => assert.equal(await askOpenAI(messages, OPENAI_ENV), "Resposta simulada da OpenAI."));
});

test("OpenAI adapter surfaces HTTP API errors", async () => {
  await withMockFetch(async () => jsonResponse({ error: { message: "OpenAI mock rate limit" } }, 429), async () => {
    await assert.rejects(askOpenAI(messages, OPENAI_ENV), /OpenAI mock rate limit/);
  });
});

test("OpenAI adapter rejects empty, malformed, and non-JSON successful responses", async () => {
  await withMockFetch(async () => jsonResponse({ output: [] }), async () => {
    await assert.rejects(askOpenAI(messages, OPENAI_ENV), /OpenAI returned an empty response/);
  });
  await withMockFetch(async () => new Response("{invalid json", { status: 200 }), async () => {
    await assert.rejects(askOpenAI(messages, OPENAI_ENV), /OpenAI returned an empty response/);
  });
});

test("OpenAI adapter propagates request timeout errors", async () => {
  await withMockFetch(async (_url, options) => {
    assert.ok(options.signal);
    throw new DOMException("The operation timed out", "TimeoutError");
  }, async () => assert.rejects(askOpenAI(messages, OPENAI_ENV), { name: "TimeoutError" }));
});

test("Anthropic adapter returns text from a valid Messages API payload", async () => {
  await withMockFetch(async (url, options) => {
    assert.equal(String(url), "https://api.anthropic.com/v1/messages");
    assert.equal(options.headers["x-api-key"], "mock-anthropic-key");
    assert.equal(options.headers["anthropic-version"], "2023-06-01");
    return jsonResponse({ content: [{ type: "text", text: "Resposta simulada do Claude." }] });
  }, async () => assert.equal(await askAnthropic(messages, ANTHROPIC_ENV), "Resposta simulada do Claude."));
});

test("Anthropic adapter surfaces HTTP API errors", async () => {
  await withMockFetch(async () => jsonResponse({ error: { message: "Anthropic mock overloaded" } }, 529), async () => {
    await assert.rejects(askAnthropic(messages, ANTHROPIC_ENV), /Anthropic mock overloaded/);
  });
});

test("Anthropic adapter rejects empty, malformed, and non-JSON successful responses", async () => {
  await withMockFetch(async () => jsonResponse({ content: [] }), async () => {
    await assert.rejects(askAnthropic(messages, ANTHROPIC_ENV), /Anthropic returned an empty response/);
  });
  await withMockFetch(async () => new Response("{invalid json", { status: 200 }), async () => {
    await assert.rejects(askAnthropic(messages, ANTHROPIC_ENV), /Anthropic returned an empty response/);
  });
});

test("Anthropic adapter propagates request timeout errors", async () => {
  await withMockFetch(async (_url, options) => {
    assert.ok(options.signal);
    throw new DOMException("The operation timed out", "TimeoutError");
  }, async () => assert.rejects(askAnthropic(messages, ANTHROPIC_ENV), { name: "TimeoutError" }));
});

test("Gemini adapter uses the official generateContent API and extracts text", async () => {
  await withMockFetch(async (url, options) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.origin, "https://generativelanguage.googleapis.com");
    assert.equal(parsed.pathname, "/v1beta/models/gemini-2.5-flash:generateContent");
    assert.equal(options.headers["x-goog-api-key"], "mock-gemini-key");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["Content-Type"], "application/json");
    const body = JSON.parse(options.body);
    assert.equal(body.contents[0].role, "user");
    assert.equal(body.systemInstruction.parts[0].text.includes("assistente pessoal"), true);
    return jsonResponse({ candidates: [{ content: { parts: [{ text: "Resposta simulada do Gemini." }] } }] });
  }, async () => assert.equal(await askGemini(messages, GEMINI_ENV), "Resposta simulada do Gemini."));
});

test("Gemini adapter maps assistant turns to model and separates system instructions", () => {
  const history = [
    { role: "system", content: "Siga o contexto específico." },
    { role: "user", content: "Primeira pergunta" },
    { role: "assistant", content: "Primeira resposta" },
    { role: "user", content: "Segunda pergunta" }
  ];
  assert.deepEqual(toGeminiContents(history), [
    { role: "user", parts: [{ text: "Primeira pergunta" }] },
    { role: "model", parts: [{ text: "Primeira resposta" }] },
    { role: "user", parts: [{ text: "Segunda pergunta" }] }
  ]);
  assert.match(toGeminiSystemInstruction(history), /Siga o contexto específico/);
});

test("Gemini adapter surfaces HTTP errors including 429", async () => {
  for (const status of [400, 429, 500]) {
    await withMockFetch(async () => jsonResponse({ error: { message: `Gemini mock HTTP ${status}` } }, status), async () => {
      await assert.rejects(askGemini(messages, GEMINI_ENV), new RegExp(`Gemini mock HTTP ${status}`));
    });
  }
});

test("Gemini adapter rejects empty and malformed successful responses", async () => {
  await withMockFetch(async () => jsonResponse({ candidates: [] }), async () => {
    await assert.rejects(askGemini(messages, GEMINI_ENV), /empty response/);
  });
  await withMockFetch(async () => new Response("{invalid json", { status: 200 }), async () => {
    await assert.rejects(askGemini(messages, GEMINI_ENV), /empty response/);
  });
});

test("Gemini adapter propagates request timeout errors", async () => {
  await withMockFetch(async (_url, options) => {
    assert.ok(options.signal);
    throw new DOMException("The operation timed out", "TimeoutError");
  }, async () => assert.rejects(askGemini(messages, GEMINI_ENV), { name: "TimeoutError" }));
});

async function chatWithMockedProviders({ prompt, mockFetch, envOverrides = {} }) {
  const token = await createSession(SESSION_SECRET);
  const env = {
    BEE_ACCESS_CODE: "unused",
    SESSION_SECRET,
    OPENAI_API_KEY: "mock-openai-key",
    ANTHROPIC_API_KEY: "mock-anthropic-key",
    CHAT_RATE_LIMITER: { limit: async () => ({ success: true }) },
    ...envOverrides
  };
  return withMockFetch(mockFetch, async () => {
    const response = await worker.fetch(new Request("https://bee.example/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messages: [{ role: "user", content: prompt }] })
    }), env);
    return { response, body: await response.json() };
  });
}

test("fallback: OpenAI failure is recovered by Anthropic", async () => {
  const calls = [];
  const result = await chatWithMockedProviders({
    prompt: "Oi!",
    mockFetch: async (url) => {
      const provider = String(url).includes("openai.com") ? "openai" : "anthropic";
      calls.push(provider);
      if (provider === "openai") return jsonResponse({ error: { message: "OpenAI unavailable" } }, 503);
      return jsonResponse({ content: [{ type: "text", text: "Claude respondeu." }] });
    }
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, { answer: "Claude respondeu.", provider: "anthropic" });
  assert.deepEqual(calls, ["openai", "anthropic"]);
});

test("fallback: Anthropic failure is recovered by OpenAI", async () => {
  const calls = [];
  const result = await chatWithMockedProviders({
    prompt: "Faça uma análise detalhada desta situação.",
    mockFetch: async (url) => {
      const provider = String(url).includes("openai.com") ? "openai" : "anthropic";
      calls.push(provider);
      if (provider === "anthropic") return jsonResponse({ error: { message: "Claude unavailable" } }, 529);
      return jsonResponse({ output: [{ type: "message", content: [{ type: "output_text", text: "OpenAI respondeu." }] }] });
    }
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, { answer: "OpenAI respondeu.", provider: "openai" });
  assert.deepEqual(calls, ["anthropic", "openai"]);
});

test("fallback: Gemini recovers after both existing providers fail", async () => {
  const calls = [];
  const result = await chatWithMockedProviders({
    prompt: "Oi!",
    envOverrides: { GEMINI_API_KEY: "mock-gemini-key" },
    mockFetch: async (url) => {
      const value = String(url);
      const provider = value.includes("openai.com") ? "openai" :
        value.includes("anthropic.com") ? "anthropic" : "gemini";
      calls.push(provider);
      if (provider !== "gemini") return jsonResponse({ error: { message: "Provider unavailable" } }, 503);
      return jsonResponse({ candidates: [{ content: { parts: [{ text: "Gemini respondeu." }] } }] });
    }
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, { answer: "Gemini respondeu.", provider: "gemini" });
  assert.deepEqual(calls, ["openai", "anthropic", "gemini"]);
});

test("fallback: Gemini is skipped when its credential is absent", async () => {
  const calls = [];
  const result = await chatWithMockedProviders({
    prompt: "Oi!",
    mockFetch: async (url) => {
      calls.push(String(url).includes("openai.com") ? "openai" : "anthropic");
      return jsonResponse({ error: { message: "Provider unavailable" } }, 503);
    }
  });
  assert.equal(result.response.status, 502);
  assert.deepEqual(calls, ["openai", "anthropic"]);
});

test("returns 503 when no provider credentials are configured", async () => {
  const result = await chatWithMockedProviders({
    prompt: "Oi!",
    envOverrides: { OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "" },
    mockFetch: async () => { throw new Error("No provider should be called"); }
  });
  assert.equal(result.response.status, 503);
});


test("Gemini works as the only configured provider", async () => {
  const result = await chatWithMockedProviders({
    prompt: "Oi!",
    envOverrides: { OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "mock-gemini-key" },
    mockFetch: async (url) => {
      assert.match(String(url), /generativelanguage\.googleapis\.com/);
      return jsonResponse({ candidates: [{ content: { parts: [{ text: "Gemini sozinho." }] } }] });
    }
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, { answer: "Gemini sozinho.", provider: "gemini" });
});
