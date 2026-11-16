import test from "node:test";
import assert from "node:assert/strict";
import { createUpstashRateLimiters } from "../src/security/upstash-rate-limit.js";

const env = {
  UPSTASH_REDIS_REST_URL: "https://mock-redis.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "mock-token-not-a-real-credential"
};
const validResult = {
  success: true,
  limit: 5,
  remaining: 4,
  reset: 1_800_000_000_000
};

function dependencies(resultForKey = async () => validResult) {
  const redisOptions = [];
  const limiterOptions = [];
  const calls = [];
  class MockRedis {
    constructor(options) { redisOptions.push(options); }
  }
  class MockRatelimit {
    constructor(options) {
      this.options = options;
      limiterOptions.push(options);
    }
    static slidingWindow(requests, window) {
      return { requests, window };
    }
    async limit(key) {
      calls.push({ key, prefix: this.options.prefix });
      if (resultForKey instanceof Error) throw resultForKey;
      return resultForKey(key, this.options);
    }
  }
  return {
    deps: { Redis: MockRedis, Ratelimit: MockRatelimit },
    redisOptions,
    limiterOptions,
    calls
  };
}

test("does not initialize Redis without both server credentials", () => {
  const mock = dependencies();
  const result = createUpstashRateLimiters({}, mock.deps);
  assert.equal(result.loginRateLimiter, null);
  assert.equal(result.chatRateLimiter, null);
  assert.equal(mock.redisOptions.length, 0);
});

test("creates independent atomic sliding-window limiters without memory cache", async () => {
  const mock = dependencies();
  const result = createUpstashRateLimiters(env, mock.deps);
  assert.equal(mock.redisOptions.length, 1);
  assert.equal(mock.redisOptions[0].enableTelemetry, false);
  assert.equal(mock.limiterOptions.length, 2);
  assert.deepEqual(mock.limiterOptions.map((item) => item.limiter), [
    { requests: 5, window: "60 s" },
    { requests: 20, window: "60 s" }
  ]);
  assert.deepEqual(mock.limiterOptions.map((item) => item.prefix), [
    "bee:login:ip",
    "bee:chat:session"
  ]);
  for (const options of mock.limiterOptions) {
    assert.equal(options.ephemeralCache, false);
    assert.equal(options.analytics, false);
    assert.equal(options.timeout, 1500);
    assert.equal(options.enableTelemetry, false);
  }
  assert.deepEqual(await result.loginRateLimiter.limit({ key: "login:203.0.113.1" }), { success: true });
  assert.deepEqual(await result.chatRateLimiter.limit({ key: "session:abc" }), { success: true });
  assert.deepEqual(mock.calls.map((call) => call.prefix), ["bee:login:ip", "bee:chat:session"]);
});

test("returns an explicit blocked result for a valid rate-limit denial", async () => {
  const mock = dependencies(async () => ({
    success: false, limit: 5, remaining: 0, reset: validResult.reset, reason: "rateLimit"
  }));
  const result = createUpstashRateLimiters(env, mock.deps);
  assert.deepEqual(await result.loginRateLimiter.limit({ key: "login:203.0.113.2" }), { success: false });
});

test("converts SDK timeout responses into an inconclusive result", async () => {
  const mock = dependencies(async () => ({
    success: true, reason: "timeout", limit: 5, remaining: 4, reset: validResult.reset
  }));
  const result = createUpstashRateLimiters(env, mock.deps);
  assert.deepEqual(await result.loginRateLimiter.limit({ key: "login:203.0.113.3" }), { success: null });
});

test("converts Redis errors into an inconclusive result for the HTTP layer", async () => {
  const mock = dependencies(new Error("network down"));
  const result = createUpstashRateLimiters(env, mock.deps);
  assert.deepEqual(await result.chatRateLimiter.limit({ key: "session:abc" }), { success: null });
});

test("fails closed when limiter initialization itself throws", () => {
  class BrokenRedis {
    constructor() { throw new Error("invalid Redis configuration"); }
  }
  const result = createUpstashRateLimiters(env, { Redis: BrokenRedis, Ratelimit: class {} });
  assert.equal(result.loginRateLimiter, null);
  assert.equal(result.chatRateLimiter, null);
});

test("treats malformed SDK responses as inconclusive", async () => {
  const mock = dependencies(async () => ({ remaining: 0 }));
  const result = createUpstashRateLimiters(env, mock.deps);
  assert.deepEqual(await result.chatRateLimiter.limit({ key: "session:abc" }), { success: null });
});

test("accepts a valid Upstash REST URL and trims a non-empty token", async () => {
  const mock = dependencies();
  const result = createUpstashRateLimiters(
    { ...env, UPSTASH_REDIS_REST_TOKEN: "  mock-token  " },
    mock.deps
  );
  assert.ok(result.loginRateLimiter);
  assert.equal(mock.redisOptions[0].url, env.UPSTASH_REDIS_REST_URL);
  assert.equal(mock.redisOptions[0].token, "mock-token");
});

test("rejects malformed URLs, URLs without a host, and incompatible REST URLs", () => {
  const invalidUrls = [
    "not a URL", "https://", "https:///missing-host", "https://example.com",
    "http://mock-redis.upstash.io", "ftp://mock-redis.upstash.io",
    "https://user:pass@mock-redis.upstash.io", "https://mock-redis.upstash.io/path",
    "https://mock-redis.upstash.io?query=1", "https://mock-redis.upstash.io#fragment",
    " https://mock-redis.upstash.io"
  ];
  for (const url of invalidUrls) {
    let constructed = false;
    class Redis { constructor() { constructed = true; } }
    const result = createUpstashRateLimiters(
      { ...env, UPSTASH_REDIS_REST_URL: url },
      { Redis, Ratelimit: class {} }
    );
    assert.deepEqual(result, { loginRateLimiter: null, chatRateLimiter: null }, url);
    assert.equal(constructed, false, url);
  }
});

test("rejects empty or whitespace-only Upstash tokens before constructing Redis", () => {
  for (const token of ["", "   ", "\t\n"]) {
    let constructed = false;
    class Redis { constructor() { constructed = true; } }
    const result = createUpstashRateLimiters(
      { ...env, UPSTASH_REDIS_REST_TOKEN: token },
      { Redis, Ratelimit: class {} }
    );
    assert.deepEqual(result, { loginRateLimiter: null, chatRateLimiter: null });
    assert.equal(constructed, false);
  }
});

test("ambiguous, incomplete, and unexpected Upstash results never authorize", async () => {
  const unexpected = [
    null, undefined, {}, { success: "true", limit: 5, remaining: 4, reset: validResult.reset },
    { success: true }, { success: true, limit: 0, remaining: 0, reset: validResult.reset },
    { success: true, limit: 5, remaining: -1, reset: validResult.reset },
    { success: true, limit: 5, remaining: 6, reset: validResult.reset },
    { success: true, limit: 5, remaining: 4, reset: "later" },
    { success: true, limit: 5, remaining: 4, reset: 0 },
    { success: true, limit: 5, remaining: 4, reset: validResult.reset, reason: "timeout" },
    { success: true, limit: 5, remaining: 4, reset: validResult.reset, reason: "unknown" },
    { success: false, limit: 5, remaining: 0, reset: validResult.reset, reason: "unknown" },
    []
  ];
  for (const response of unexpected) {
    const result = createUpstashRateLimiters(env, dependencies(async () => response).deps);
    assert.deepEqual(await result.loginRateLimiter.limit({ key: "login:test" }), { success: null });
  }
});

test("preserves recognized rate-limit and deny-list blocks but rejects other reasons", async () => {
  for (const reason of ["rateLimit", "denyList"]) {
    const response = { success: false, limit: 5, remaining: 0, reset: validResult.reset, reason };
    const result = createUpstashRateLimiters(env, dependencies(async () => response).deps);
    assert.deepEqual(await result.loginRateLimiter.limit({ key: "login:test" }), { success: false });
  }
});

test("HTTP 401 and 403 responses fail closed", async () => {
  for (const status of [401, 403]) {
    const error = Object.assign(new Error(`Upstash HTTP ${status}`), { status });
    const result = createUpstashRateLimiters(env, dependencies(error).deps);
    assert.deepEqual(await result.loginRateLimiter.limit({ key: "login:test" }), { success: null });
  }
});

test("connection failures and SDK exceptions fail closed", async () => {
  for (const error of [new TypeError("fetch failed"), new Error("ECONNRESET"), new Error("request timeout")]) {
    const result = createUpstashRateLimiters(env, dependencies(error).deps);
    assert.deepEqual(await result.chatRateLimiter.limit({ key: "session:test" }), { success: null });
  }
});
