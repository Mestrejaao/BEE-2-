import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const env = {
  BEE_ACCESS_CODE: "test-access-code",
  SESSION_SECRET: "a-test-session-secret-with-at-least-32-characters",
  OPENAI_API_KEY: "test-openai-key",
  ALLOWED_ORIGINS: "https://bee.example"
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
    headers: { "Content-Type": "application/json", Origin: "https://bee.example" },
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

test("rejects chat requests without a valid session", async () => {
  const response = await worker.fetch(new Request("https://bee.example/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "Oi!" }] })
  }), env);
  assert.equal(response.status, 401);
});
