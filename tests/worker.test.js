import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const env = {
  BEE_ACCESS_CODE: "test-access-code",
  SESSION_SECRET: "a-test-session-secret-with-at-least-32-characters",
  OPENAI_API_KEY: "test-openai-key",
  ALLOWED_ORIGINS: "https://mestrejaao.github.io,https://bee.example",
  LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
  CHAT_RATE_LIMITER: { limit: async () => ({ success: true }) }
};

test("health endpoint responds without exposing configuration", async () => {
  const response = await worker.fetch(new Request("https://bee.example/api/health"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", service: "bee-api" });
});

test("rejects unapproved browser origins", async () => {
  const response = await worker.fetch(new Request("https://bee.example/api/health", {
    headers: { Origin: "https://attacker.example" }
  }), env);
  assert.equal(response.status, 403);
});

test("login issues a signed session and chat uses the configured provider", async () => {
  const login = await worker.fetch(new Request("https://bee.example/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://bee.example", "CF-Connecting-IP": "203.0.113.10" },
    body: JSON.stringify({ code: "test-access-code" })
  }), env);
  assert.equal(login.status, 200);
  const { token } = await login.json();
  assert.ok(token);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    return new Response(JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: "Olá! Sou a BEE." }] }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const chat = await worker.fetch(new Request("https://bee.example/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        Origin: "https://bee.example"
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "Oi!" }] })
    }), env);
    assert.equal(chat.status, 200);
    assert.deepEqual(await chat.json(), { answer: "Olá! Sou a BEE.", provider: "openai" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects login attempts after the Cloudflare rate limit and ignores spoofed IP headers", async () => {
  let receivedKey = "";
  const limitedEnv = {
    ...env,
    LOGIN_RATE_LIMITER: { limit: async ({ key }) => { receivedKey = key; return { success: false }; } }
  };
  const response = await worker.fetch(new Request("https://bee.example/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "203.0.113.25",
      "X-Forwarded-For": "198.51.100.99"
    },
    body: JSON.stringify({ code: "wrong" })
  }), limitedEnv);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
  assert.equal(receivedKey, "login:203.0.113.25");
});

test("fails closed when the trusted Cloudflare client IP is unavailable", async () => {
  const response = await worker.fetch(new Request("https://bee.example/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.25" },
    body: JSON.stringify({ code: "test-access-code" })
  }), env);
  assert.equal(response.status, 503);
});

test("returns 429 for chat when the Cloudflare rate limiter denies the request", async () => {
  const login = await worker.fetch(new Request("https://bee.example/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.10" },
    body: JSON.stringify({ code: "test-access-code" })
  }), env);
  const { token } = await login.json();
  const limitedEnv = { ...env, CHAT_RATE_LIMITER: { limit: async () => ({ success: false }) } };
  const response = await worker.fetch(new Request("https://bee.example/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages: [{ role: "user", content: "Oi!" }] })
  }), limitedEnv);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
});

test("returns 503 rather than bypassing a missing rate limiter binding", async () => {
  const unconfigured = { ...env };
  delete unconfigured.LOGIN_RATE_LIMITER;
  const response = await worker.fetch(new Request("https://bee.example/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.10" },
    body: JSON.stringify({ code: "test-access-code" })
  }), unconfigured);
  assert.equal(response.status, 503);
});

test("fails closed when the chat rate limiter errors", async () => {
  const login = await worker.fetch(new Request("https://bee.example/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.10" },
    body: JSON.stringify({ code: "test-access-code" })
  }), env);
  const { token } = await login.json();
  const unavailableEnv = { ...env, CHAT_RATE_LIMITER: { limit: async () => { throw new Error("binding unavailable"); } } };
  const response = await worker.fetch(new Request("https://bee.example/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages: [{ role: "user", content: "Oi!" }] })
  }), unavailableEnv);
  assert.equal(response.status, 503);
});

test("rejects chat requests without a valid session before touching the rate limiter", async () => {
  let limiterCalls = 0;
  const guardedEnv = {
    ...env,
    CHAT_RATE_LIMITER: { limit: async () => { limiterCalls += 1; return { success: true }; } }
  };
  const response = await worker.fetch(new Request("https://bee.example/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer invalid-session" },
    body: JSON.stringify({ messages: [{ role: "user", content: "Oi!" }] })
  }), guardedEnv);
  assert.equal(response.status, 401);
  assert.equal(limiterCalls, 0);
});


test("allows the production GitHub Pages origin and returns CORS headers", async () => {
  const response = await worker.fetch(new Request("https://bee.example/api/health", {
    headers: { Origin: "https://mestrejaao.github.io" }
  }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://mestrejaao.github.io");
  assert.equal(response.headers.get("Vary"), "Origin");
});

test("answers GitHub Pages preflight for authenticated JSON chat requests", async () => {
  const response = await worker.fetch(new Request("https://bee.example/api/chat", {
    method: "OPTIONS",
    headers: {
      Origin: "https://mestrejaao.github.io",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,authorization"
    }
  }), env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://mestrejaao.github.io");
  assert.match(response.headers.get("Access-Control-Allow-Methods"), /POST/);
  assert.match(response.headers.get("Access-Control-Allow-Headers"), /Authorization/i);
});


test("uses independent stable hashed rate-limit counters for different signed sessions", async () => {
  const issueSession = async () => {
    const response = await worker.fetch(new Request("https://bee.example/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.10" },
      body: JSON.stringify({ code: "test-access-code" })
    }), env);
    assert.equal(response.status, 200);
    return (await response.json()).token;
  };

  const firstToken = await issueSession();
  const secondToken = await issueSession();
  assert.notEqual(firstToken, secondToken, "sessions issued in the same second must be unique");

  const counters = new Map();
  const keys = [];
  const isolatedEnv = {
    ...env,
    CHAT_RATE_LIMITER: {
      limit: async ({ key }) => {
        keys.push(key);
        const count = (counters.get(key) || 0) + 1;
        counters.set(key, count);
        return { success: count <= 1 };
      }
    }
  };
  const sendChat = (token) => worker.fetch(new Request("https://bee.example/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages: [] })
  }), isolatedEnv);

  assert.equal((await sendChat(firstToken)).status, 400);
  assert.equal((await sendChat(firstToken)).status, 429);
  assert.equal((await sendChat(secondToken)).status, 400);

  assert.equal(keys.length, 3);
  assert.equal(keys[0], keys[1], "the same session must reuse its stable key");
  assert.notEqual(keys[0], keys[2], "different sessions must use independent keys");
  assert.ok(keys.every((key) => !key.includes(firstToken) && !key.includes(secondToken)),
    "raw bearer tokens must never be used as rate-limit keys");
});

test("fails closed when the chat rate limiter binding is missing", async () => {
  const login = await worker.fetch(new Request("https://bee.example/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.10" },
    body: JSON.stringify({ code: "test-access-code" })
  }), env);
  const { token } = await login.json();
  const unconfigured = { ...env };
  delete unconfigured.CHAT_RATE_LIMITER;
  const response = await worker.fetch(new Request("https://bee.example/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages: [] })
  }), unconfigured);
  assert.equal(response.status, 503);
});
