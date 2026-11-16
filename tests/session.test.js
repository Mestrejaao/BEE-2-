import test from "node:test";
import assert from "node:assert/strict";
import { createSession, verifySession, constantTimeEqual } from "../src/security/session.js";

const TEST_SECRET = "fictional-test-secret-only-never-use-in-production";
const encoder = new TextEncoder();

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function signTestPayload(payload, secret = TEST_SECRET) {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return body + "." + toBase64Url(new Uint8Array(signature));
}

test("creates a session token with a valid 128-bit jti that verifies before expiration", async () => {
  const now = 1_800_000_000_000;
  const token = await createSession(TEST_SECRET, now);
  const [body] = token.split(".");
  const normalized = body.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))));
  assert.match(payload.jti, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(await verifySession(token, TEST_SECRET, now + 1000), true);
});

test("rejects legacy tokens without jti, including a valid legacy HMAC signature", async () => {
  const now = 1_800_000_000_000;
  const legacyToken = await signTestPayload({
    sub: "bee-user",
    exp: Math.floor(now / 1000) + 60 * 60 * 12
  });
  assert.equal(await verifySession(legacyToken, TEST_SECRET, now), false);
});

test("rejects sessions with absent, empty, or malformed jti", async () => {
  const now = 1_800_000_000_000;
  const base = { sub: "bee-user", exp: Math.floor(now / 1000) + 3600 };
  for (const payload of [
    base,
    { ...base, jti: "" },
    { ...base, jti: "not-a-session-id" },
    { ...base, jti: "A".repeat(21) },
    { ...base, jti: "A".repeat(21) + "B" },
    { ...base, jti: "A".repeat(22) + "A" }
  ]) {
    const token = await signTestPayload(payload);
    assert.equal(await verifySession(token, TEST_SECRET, now), false);
  }
});

test("rejects expired, altered, and wrongly signed sessions", async () => {
  const now = 1_800_000_000_000;
  const token = await createSession(TEST_SECRET, now);
  assert.equal(await verifySession(token, TEST_SECRET, now + 13 * 60 * 60 * 1000), false);
  assert.equal(await verifySession(token + "x", TEST_SECRET, now), false);
  assert.equal(await verifySession(token, "another-fictional-test-secret-long-enough", now), false);
});

test("tokens issued in the same second remain different", async () => {
  const now = 1_800_000_000_000;
  const first = await createSession(TEST_SECRET, now);
  const second = await createSession(TEST_SECRET, now);
  assert.notEqual(first, second);
  assert.equal(await verifySession(first, TEST_SECRET, now), true);
  assert.equal(await verifySession(second, TEST_SECRET, now), true);
});

test("compares access codes without a direct early-exit string comparison", async () => {
  assert.equal(await constantTimeEqual("bee-code", "bee-code"), true);
  assert.equal(await constantTimeEqual("bee-code", "wrong-code"), false);
});
