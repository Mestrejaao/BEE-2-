import test from "node:test";
import assert from "node:assert/strict";
import { createUpstashRateLimiters } from "../src/security/upstash-rate-limit.js";

const env = {
  UPSTASH_REDIS_REST_URL: "https://mock-redis.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "mock-token-not-a-real-credential"
};

function dependencies(resultForKey = async () => ({ success: true })) {
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

test("returns an explicit blocked result when Redis says the limit was exceeded", async () => {
  const mock = dependencies(async () => ({ success: false, reason: "rateLimit" }));
  const result = createUpstashRateLimiters(env, mock.deps);
  assert.deepEqual(await result.loginRateLimiter.limit({ key: "login:203.0.113.2" }), { success: false });
});

test("converts the SDK fail-open timeout response into an inconclusive result", async () => {
  const mock = dependencies(async () => ({
    success: true,
    reason: "timeout",
    limit: 5,
    remaining: 4
  }));
  const result = createUpstashRateLimiters(env, mock.deps);
  assert.deepEqual(await result.loginRateLimiter.limit({ key: "login:203.0.113.3" }), { success: null });
});

test("propagates Redis errors so the HTTP handler can return 503", async () => {
  const mock = dependencies(async () => { throw new Error("network down"); });
  const result = createUpstashRateLimiters(env, mock.deps);
  await assert.rejects(
    result.chatRateLimiter.limit({ key: "session:abc" }),
    /network down/
  );
});

test("fails closed when limiter initialization itself throws", () => {
  class BrokenRedis {
    constructor() { throw new Error("invalid Redis configuration"); }
  }
  class UnusedRatelimit {}
  const result = createUpstashRateLimiters(env, { Redis: BrokenRedis, Ratelimit: UnusedRatelimit });
  assert.equal(result.loginRateLimiter, null);
  assert.equal(result.chatRateLimiter, null);
});

test("treats malformed SDK responses as inconclusive", async () => {
  const mock = dependencies(async () => ({ remaining: 0 }));
  const result = createUpstashRateLimiters(env, mock.deps);
  assert.deepEqual(await result.chatRateLimiter.limit({ key: "session:abc" }), { success: null });
});
