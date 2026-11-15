import { handleRequest } from "../src/index.js";

/**
 * Vercel Node.js Function adapter.
 *
 * Protected routes deliberately fail closed until a durable, account-approved
 * rate limiter is configured. Never replace this with process-local counters.
 */
export function createVercelHandler(readEnv = () => process.env) {
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

      // No in-memory or unverified limiter is substituted here. The shared
      // handler returns HTTP 503 for login/chat while the durable protection
      // is not available; /api/health remains usable.
      return handleRequest(request, env);
    }
  };
}

export default createVercelHandler();
