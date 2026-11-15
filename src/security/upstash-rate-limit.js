import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const TIMEOUT_MS = 1500;

/**
 * Build independent, Redis-backed limiters for Vercel.
 * The Upstash SDK's default ephemeral Map cache is explicitly disabled.
 * SDK timeout responses are fail-open by design, so they are converted into
 * an inconclusive result that the HTTP layer maps to 503.
 */
export function createUpstashRateLimiters(env, dependencies = {}) {
  const RedisClient = dependencies.Redis ?? Redis;
  const RateLimit = dependencies.Ratelimit ?? Ratelimit;
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;

  if (typeof url !== "string" || !url.startsWith("https://") ||
      typeof token !== "string" || !token.trim()) {
    return { loginRateLimiter: null, chatRateLimiter: null };
  }

  try {
    const redis = new RedisClient({
      url,
      token,
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
          const result = await limiter.limit(key);
          if (!result || typeof result.success !== "boolean" ||
              result.reason === "timeout") {
            return { success: null };
          }
          return { success: result.success };
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
