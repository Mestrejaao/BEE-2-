import test from "node:test";
import assert from "node:assert/strict";
import { createVercelHandler } from "../api/[...path].js";
import { createSession } from "../src/security/session.js";

const secret = "vercel-test-session-secret-with-at-least-32-characters";
const env = {
  BEE_ACCESS_CODE: "test-access-code",
  SESSION_SECRET: secret,
  OPENAI_API_KEY: "mock-openai-key",
  ALLOWED_ORIGINS: "https://mestrejaao.github.io"
};
const handler = createVercelHandler(() => env);

test("Vercel adapter serves the API health endpoint", async () => {
  const response = await handler.fetch(new Request("https://bee.vercel.app/api/health", {
    headers: { Origin: "https://mestrejaao.github.io" }
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", service: "bee-api" });
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://mestrejaao.github.io");
});

test("Vercel adapter fails closed for login until durable rate limiting is configured", async () => {
  const response = await handler.fetch(new Request("https://bee.vercel.app/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://mestrejaao.github.io" },
    body: JSON.stringify({ code: "test-access-code" })
  }));
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /Proteção temporariamente indisponível/);
});

test("Vercel adapter fails closed for authenticated chat until durable rate limiting is configured", async () => {
  const token = await createSession(secret);
  const response = await handler.fetch(new Request("https://bee.vercel.app/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      Origin: "https://mestrejaao.github.io"
    },
    body: JSON.stringify({ messages: [{ role: "user", content: "Oi!" }] })
  }));
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /Proteção temporariamente indisponível/);
});

test("Vercel adapter does not allow an unapproved origin", async () => {
  const response = await handler.fetch(new Request("https://bee.vercel.app/api/health", {
    headers: { Origin: "https://attacker.example" }
  }));
  assert.equal(response.status, 403);
});
