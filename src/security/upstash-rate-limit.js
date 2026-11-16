import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const TIMEOUT_MS = 1500;
const UPSTASH_REST_HOST_SUFFIX = ".upstash.io";

function isValidRestUrl(value) {
  if (typeof value !== "string" || !value || value !== value.trim()) return false;

  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" &&
      parsed.hostname.length > UPSTASH_REST_HOST_SUFFIX.length &&
      parsed.hostname.endsWith(UPSTASH_REST_HOST_SUFFIX) &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port &&
      (parsed.pathname === "" || parsed.pathname === "/") &&
      !parsed.search &&
      !parsed.hash;
  } catch {
    return false;
  }
}

function isValidLimiterResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  if (typeof result.success !== "boolean") return false;
  if (!Number.isSafeInteger(result.limit) || result.limit <= 0) return false;
  if (!Number.isSafeInteger(result.remaining) ||
      result.remaining < 0 || result.remaining > result.limit) return false;
  if (!Number.isSafeInteger(result.reset) || result.reset <= 0) return false;

  // A timeout or any unrecognized reason is inconclusive, not permission.
  if (result.reason !== undefined) return false;
  return true;
}

/**
 * Build independent, Redis-backed limiters for Vercel.
 * The SDK's ephemeral Map cache is disabled. Every inconclusive response or
 * Redis error is converted to a non-allowing result for the HTTP layer (503).
 */
export function createUpstashRateLimiters(env, dependencies = {}) {
  const RedisClient = dependencies.Redis ?? Redis;
  const RateLimit = dependencies.Ratelimit ?? Ratelimit;
  const url = env?.UPSTASH_REDIS_REST_URL;
  const token = env?.UPSTASH_REDIS_REST_TOKEN;

  if (!isValidRestUrl(url) || typeof token !== "string" || !token.trim()) {
    return { loginRateLimiter: null, chatRateLimiter: null };
  }

  try {
    const redis = new RedisClient({
      url,
      token: token.trim(),
      enableTelemetry: false
    });

    const createLimiter = (prefix, requests) => {
      const limiter = new RateLimit({
        redis,
        limiter: RateLimit.slidingWindow(requests, "60 s"),
        prefix,
        ephemeralCache: false,
        analytics: false,
        timeout: TIMEOUT_MS,
        enableTelemetry: false
      });

      return {
        async limit({ key }) {
          try {
            const result = await limiter.limit(key);
            return isValidLimiterResult(result)
              ? { success: result.success }
              : { success: null };
          } catch {
            // Includes HTTP 401/403, network errors, and SDK parsing failures.
            return { success: null };
          }
        }
      };
    };

    return {
      loginRateLimiter: createLimiter("bee:login:ip", 5),
      chatRateLimiter: createLimiter("bee:chat:session", 20)
    };
  } catch {
    return { loginRateLimiter: null, chatRateLimiter: null };
  }
}
