import test from "node:test";
import assert from "node:assert/strict";
import { createUpstashRateLimiters } from "../src/security/upstash-rate-limit.js";

const validEnv = {
  UPSTASH_REDIS_REST_URL: "https://example-12345.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "mock-upstash-token"
};

function dependenciesFor(resultOrError, calls = {}) {
  class MockRedis {
    constructor(options) {
      calls.redisOptions = options;
    }
  }
  class MockRatelimit {
    static slidingWindow(requests, window) {
      calls.window = { requests, window };
      return { requests, window };
    }
    constructor(options) {
      calls.limiterOptions = options;
      this.resultOrError = resultOrError;
    }
    async limit(key) {
      calls.key = key;
      if (this.resultOrError instanceof Error) throw this.resultOrError;
      if (typeof this.resultOrError === "function") return this.resultOrError();
      return this.resultOrError;
    }
  }
  return { Redis: MockRedis, Ratelimit: MockRatelimit };
}

const validResult = {
  success: true,
  limit: 5,
  remaining: 4,
  reset: 1_800_000_000_000
};

test("accepts a valid Upstash REST URL and preserves independent limiter limits", async () => {
  const calls = {};
  const { loginRateLimiter, chatRateLimiter } = createUpstashRateLimiters(
    validEnv,
    dependenciesFor(validResult, calls)
  );

  assert.ok(loginRateLimiter);
  assert.ok(chatRateLimiter);
  assert.equal(calls.redisOptions.url, validEnv.UPSTASH_REDIS_REST_URL);
  assert.equal(calls.redisOptions.token, validEnv.UPSTASH_REDIS_REST_TOKEN);
  assert.deepEqual(calls.window, { requests: 20, window: "60 s" });
  assert.equal(calls.limiterOptions.ephemeralCache, false);
  assert.deepEqual(await loginRateLimiter.limit({ key: "ip:203.0.113.1" }), { success: true });
  assert.deepEqual(await chatRateLimiter.limit({ key: "session:abc" }), { success: true });
});

test("rejects malformed URLs, URLs without a host, and incompatible REST URLs", () => {
  const invalidUrls = [
    "not a URL",
    "https://",
    "https:///missing-host",
    "https://example.com",
    "http://example-12345.upstash.io",
    "ftp://example-12345.upstash.io",
    "https://user:pass@example-12345.upstash.io",
    "https://example-12345.upstash.io/path",
    "https://example-12345.upstash.io?query=1",
    "https://example-12345.upstash.io#fragment",
    " https://example-12345.upstash.io"
  ];

  for (const url of invalidUrls) {
    let constructed = false;
    class Redis {
      constructor() { constructed = true; }
    }
    const result = createUpstashRateLimiters(
      { ...validEnv, UPSTASH_REDIS_REST_URL: url },
      { Redis, Ratelimit: class {} }
    );
    assert.deepEqual(result, { loginRateLimiter: null, chatRateLimiter: null }, url);
    assert.equal(constructed, false, url);
  }
});

test("rejects empty or whitespace-only Upstash tokens before constructing Redis", () => {
  for (const token of ["", "   ", "\t\n"]) {
    let constructed = false;
    class Redis {
      constructor() { constructed = true; }
    }
    const result = createUpstashRateLimiters(
      { ...validEnv, UPSTASH_REDIS_REST_TOKEN: token },
      { Redis, Ratelimit: class {} }
    );
    assert.deepEqual(result, { loginRateLimiter: null, chatRateLimiter: null });
    assert.equal(constructed, false);
  }
});

test("ambiguous, incomplete, and unexpected Upstash results never authorize", async () => {
  const unexpected = [
    null,
    undefined,
    {},
    { success: "true", limit: 5, remaining: 4, reset: validResult.reset },
    { success: true },
    { success: true, limit: 0, remaining: 0, reset: validResult.reset },
    { success: true, limit: 5, remaining: -1, reset: validResult.reset },
    { success: true, limit: 5, remaining: 6, reset: validResult.reset },
    { success: true, limit: 5, remaining: 4, reset: "later" },
    { success: true, limit: 5, remaining: 4, reset: 0 },
    { success: true, limit: 5, remaining: 4, reset: validResult.reset, reason: "timeout" },
    { success: true, limit: 5, remaining: 4, reset: validResult.reset, reason: "unknown" },
    []
  ];

  for (const result of unexpected) {
    const { loginRateLimiter } = createUpstashRateLimiters(
      validEnv,
      dependenciesFor(result)
    );
    assert.deepEqual(
      await loginRateLimiter.limit({ key: "login:test" }),
      { success: null }
    );
  }
});

test("a valid denial remains a denial", async () => {
  const { loginRateLimiter } = createUpstashRateLimiters(
    validEnv,
    dependenciesFor({ ...validResult, success: false, remaining: 0 })
  );
  assert.deepEqual(
    await loginRateLimiter.limit({ key: "login:test" }),
    { success: false }
  );
});

test("HTTP 401 and 403 responses fail closed", async () => {
  for (const status of [401, 403]) {
    const error = Object.assign(new Error(`Upstash HTTP ${status}`), { status });
    const { loginRateLimiter } = createUpstashRateLimiters(
      validEnv,
      dependenciesFor(error)
    );
    assert.deepEqual(
      await loginRateLimiter.limit({ key: "login:test" }),
      { success: null }
    );
  }
});

test("connection failures and SDK exceptions fail closed", async () => {
  for (const error of [
    new TypeError("fetch failed"),
    new Error("ECONNRESET"),
    new Error("Upstash request timeout")
  ]) {
    const { chatRateLimiter } = createUpstashRateLimiters(
      validEnv,
      dependenciesFor(error)
    );
    assert.deepEqual(
      await chatRateLimiter.limit({ key: "session:test" }),
      { success: null }
    );
  }
});

test("Redis construction failures disable both limiters", () => {
  class BrokenRedis {
    constructor() { throw new Error("invalid Redis configuration"); }
  }
  assert.deepEqual(
    createUpstashRateLimiters(validEnv, {
      Redis: BrokenRedis,
      Ratelimit: class {}
    }),
    { loginRateLimiter: null, chatRateLimiter: null }
  );
});
