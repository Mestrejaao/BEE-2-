import test from "node:test";
import assert from "node:assert/strict";
import { askOpenAI } from "../src/providers/openai.js";
import { askAnthropic } from "../src/providers/anthropic.js";
import worker from "../src/index.js";
import { createSession } from "../src/security/session.js";

const OPENAI_ENV = { OPENAI_API_KEY: "mock-openai-key" };
const ANTHROPIC_ENV = { ANTHROPIC_API_KEY: "mock-anthropic-key" };
const SESSION_SECRET = "unit-test-session-secret-with-at-least-32-characters";
const messages = [{ role: "user", content: "Olá, BEE!" }];

async function withMockFetch(mock, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

test("OpenAI adapter returns text from a valid Responses API payload", async () => {
  await withMockFetch(async (url, options) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    assert.equal(options.headers.Authorization, "Bearer mock-openai-key");
    return jsonResponse({
      output: [{
        type: "message",
        content: [{ type: "output_text", text: "Resposta simulada da OpenAI." }]
      }]
    });
  }, async () => {
    assert.equal(await askOpenAI(messages, OPENAI_ENV), "Resposta simulada da OpenAI.");
  });
});

test("OpenAI adapter surfaces HTTP API errors", async () => {
  await withMockFetch(async () => jsonResponse({
    error: { message: "OpenAI mock rate limit" }
  }, 429), async () => {
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
  }, async () => {
    await assert.rejects(askOpenAI(messages, OPENAI_ENV), { name: "TimeoutError" });
  });
});

test("Anthropic adapter returns text from a valid Messages API payload", async () => {
  await withMockFetch(async (url, options) => {
    assert.equal(String(url), "https://api.anthropic.com/v1/messages");
    assert.equal(options.headers["x-api-key"], "mock-anthropic-key");
    assert.equal(options.headers["anthropic-version"], "2023-06-01");
    return jsonResponse({
      content: [{ type: "text", text: "Resposta simulada do Claude." }]
    });
  }, async () => {
    assert.equal(await askAnthropic(messages, ANTHROPIC_ENV), "Resposta simulada do Claude.");
  });
});

test("Anthropic adapter surfaces HTTP API errors", async () => {
  await withMockFetch(async () => jsonResponse({
    error: { message: "Anthropic mock overloaded" }
  }, 529), async () => {
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
  }, async () => {
    await assert.rejects(askAnthropic(messages, ANTHROPIC_ENV), { name: "TimeoutError" });
  });
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
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
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
      return jsonResponse({
        output: [{
          type: "message",
          content: [{ type: "output_text", text: "OpenAI respondeu." }]
        }]
      });
    }
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, { answer: "OpenAI respondeu.", provider: "openai" });
  assert.deepEqual(calls, ["anthropic", "openai"]);
});

test("fallback: returns HTTP 502 when both providers fail", async () => {
  const calls = [];
  const result = await chatWithMockedProviders({
    prompt: "Oi!",
    mockFetch: async (url) => {
      calls.push(String(url).includes("openai.com") ? "openai" : "anthropic");
      return jsonResponse({ error: { message: "Provider unavailable" } }, 503);
    }
  });
  assert.equal(result.response.status, 502);
  assert.match(result.body.error, /não conseguiram responder/);
  assert.deepEqual(calls, ["openai", "anthropic"]);
});
