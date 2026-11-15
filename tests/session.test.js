import test from "node:test";
import assert from "node:assert/strict";
import { createSession, verifySession, constantTimeEqual } from "../src/security/session.js";

test("creates a session token that verifies before expiration", async () => {
  const now = 1_800_000_000_000;
  const token = await createSession("test-secret-at-least-32-bytes-long", now);
  assert.equal(await verifySession(token, "test-secret-at-least-32-bytes-long", now + 1000), true);
});

test("rejects expired, altered, and wrongly signed sessions", async () => {
  const now = 1_800_000_000_000;
  const secret = "test-secret-at-least-32-bytes-long";
  const token = await createSession(secret, now);
  assert.equal(await verifySession(token, secret, now + 13 * 60 * 60 * 1000), false);
  assert.equal(await verifySession(token + "x", secret, now), false);
  assert.equal(await verifySession(token, "a-different-secret-that-is-long-enough", now), false);
});

test("compares access codes without a direct early-exit string comparison", async () => {
  assert.equal(await constantTimeEqual("bee-code", "bee-code"), true);
  assert.equal(await constantTimeEqual("bee-code", "wrong-code"), false);
});
