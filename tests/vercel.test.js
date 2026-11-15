import test from "node:test";
import assert from "node:assert/strict";
import { createVercelHandler, sessionRateLimitKey, vercelClientIp } from "../api/[...path].js";
import { createSession } from "../src/security/session.js";

const secret = "vercel-test-session-secret-with-at-least-32-characters";
const env = {
  BEE_ACCESS_CODE: "test-access-code",
  SESSION_SECRET: secret,
  OPENAI_API_KEY: "mock-openai-key",
  ALLOWED_ORIGINS: "https://mestrejaao.github.io"
};
const allowedOrigin = "https://mestrejaao.github.io";
const request = (path, options = {}) => new Request("https://bee.vercel.app" + path, {
  ...options,
  headers: { Origin: allowedOrigin, ...(options.headers || {}) }
});
const allowedLimiters = () => ({
  loginRateLimiter: { limit: async () => ({ success: true }) },
  chatRateLimiter: { limit: async () => ({ success: true }) }
});

test("Vercel adapter serves health without requiring Redis", async () => {
  const handler = createVercelHandler(() => env);
  const response = await handler.fetch(request("/api/health"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", service: "bee-api" });
});

test("login fails closed when Upstash credentials are missing", async () => {
  const handler = createVercelHandler(() => env);
  const response = await handler.fetch(request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.10" },
    body: JSON.stringify({ code: "test-access-code" })
  }));
  assert.equal(response.status, 503);
});

test("chat fails closed when Upstash credentials are missing", async () => {
  const handler = createVercelHandler(() => env);
  const token = await createSession(secret);
  const response = await handler.fetch(request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages: [{ role: "user", content: "Oi!" }] })
  }));
  assert.equal(response.status, 503);
});

test("login uses only a single valid Vercel-forwarded IP", async () => {
  assert.equal(vercelClientIp(new Request("https://bee.vercel.app", {
    headers: { "x-forwarded-for": "203.0.113.10" }
  })), "203.0.113.10");
  assert.equal(vercelClientIp(new Request("https://bee.vercel.app", {
    headers: { "x-forwarded-for": "203.0.113.10, 198.51.100.5" }
  })), null);
  assert.equal(vercelClientIp(new Request("https://bee.vercel.app", {
    headers: { "x-forwarded-for": "not-an-ip", "x-real-ip": "203.0.113.10" }
  })), null);
});

test("login is blocked with 429 when its IP limiter denies the request", async () => {
  let key;
  const handler = createVercelHandler(() => env, () => ({
    loginRateLimiter: { limit: async (input) => { key = input.key; return { success: false }; } },
    chatRateLimiter: { limit: async () => ({ success: true }) }
  }));
  const response = await handler.fetch(request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.11" },
    body: JSON.stringify({ code: "test-access-code" })
  }));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
  assert.equal(key, "login:203.0.113.11");
});

test("login returns 503 when IP is missing or spoofable", async () => {
  const handler = createVercelHandler(() => env, allowedLimiters);
  const response = await handler.fetch(request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Real-IP": "203.0.113.10" },
    body: JSON.stringify({ code: "test-access-code" })
  }));
  assert.equal(response.status, 503);
});

test("chat uses a SHA-256 session key and returns 429 when that session is limited", async () => {
  const token = await createSession(secret);
  let key;
  const handler = createVercelHandler(() => env, () => ({
    loginRateLimiter: { limit: async () => ({ success: true }) },
    chatRateLimiter: { limit: async (input) => { key = input.key; return { success: false }; } }
  }));
  const response = await handler.fetch(request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages: [{ role: "user", content: "Oi!" }] })
  }));
  assert.equal(response.status, 429);
  assert.match(key, /^session:[a-f0-9]{64}$/);
  assert.equal(key.includes(token), false);
  assert.equal(sessionRateLimitKey(token), key);
});

test("different session tokens produce independent identifiers", async () => {
  const first = await createSession(secret, Date.now());
  const second = await createSession(secret, Date.now() + 1000);
  assert.notEqual(sessionRateLimitKey(first), sessionRateLimitKey(second));
});

test("unknown limiter result and thrown Redis errors both fail closed with 503", async () => {
  for (const limit of [
    async () => ({ success: null }),
    async () => { throw new Error("Redis unavailable"); }
  ]) {
    const handler = createVercelHandler(() => env, () => ({
      loginRateLimiter: { limit },
      chatRateLimiter: { limit }
    }));
    const response = await handler.fetch(request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.12" },
      body: JSON.stringify({ code: "test-access-code" })
    }));
    assert.equal(response.status, 503);
  }
});


test("chat returns 503 when the session limiter errors or gives an inconclusive result", async () => {
  const token = await createSession(secret);
  for (const limit of [
    async () => ({ success: null }),
    async () => { throw new Error("Redis timeout"); }
  ]) {
    const handler = createVercelHandler(() => env, () => ({
      loginRateLimiter: { limit: async () => ({ success: true }) },
      chatRateLimiter: { limit }
    }));
    const response = await handler.fetch(request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messages: [{ role: "user", content: "Oi!" }] })
    }));
    assert.equal(response.status, 503);
  }
});

test("Vercel adapter rejects an unapproved origin", async () => {
  const handler = createVercelHandler(() => env, allowedLimiters);
  const response = await handler.fetch(new Request("https://bee.vercel.app/api/health", {
    headers: { Origin: "https://attacker.example" }
  }));
  assert.equal(response.status, 403);
});
