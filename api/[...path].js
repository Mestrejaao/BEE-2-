import { isIP } from "node:net";
import { createHash } from "node:crypto";
import { handleRequest } from "../src/index.js";
import { createUpstashRateLimiters } from "../src/security/upstash-rate-limit.js";

/**
 * Vercel overwrites X-Forwarded-For with the public client IP. Accept only a
 * single syntactically valid IP address; reject lists and arbitrary headers.
 */
export function vercelClientIp(request) {
  const value = request.headers.get("x-forwarded-for");
  if (!value || value.includes(",")) return null;
  const ip = value.trim();
  return isIP(ip) ? ip : null;
}

export function sessionRateLimitKey(token) {
  if (typeof token !== "string" || !token) return null;
  return "session:" + createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Vercel Node.js Function adapter. Redis credentials are read only from the
 * server environment and are never returned to the browser.
 */
export function createVercelHandler(readEnv = () => process.env, buildLimiters = createUpstashRateLimiters) {
  return {
    async fetch(request) {
      const source = readEnv();
      const env = {
        BEE_ACCESS_CODE: source.BEE_ACCESS_CODE,
        SESSION_SECRET: source.SESSION_SECRET,
        OPENAI_API_KEY: source.OPENAI_API_KEY,
        ANTHROPIC_API_KEY: source.ANTHROPIC_API_KEY,
        OPENAI_MODEL: source.OPENAI_MODEL,
        ANTHROPIC_MODEL: source.ANTHROPIC_MODEL,
        ALLOWED_ORIGINS: source.ALLOWED_ORIGINS ||
          "https://mestrejaao.github.io,http://localhost:8787,http://127.0.0.1:8787"
      };

      let limiters;
      try {
        limiters = buildLimiters(source);
      } catch {
        limiters = null;
      }

      return handleRequest(request, env, {
        clientIp: vercelClientIp,
        loginRateLimiter: limiters?.loginRateLimiter,
        chatRateLimiter: limiters?.chatRateLimiter,
        chatIdentifier: sessionRateLimitKey
      });
    }
  };
}

export default createVercelHandler();
