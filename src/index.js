import { createSession, verifySession, constantTimeEqual } from "./security/session.js";
import { chooseProvider, getProviderOrder } from "./router/selector.js";
import { askOpenAI } from "./providers/openai.js";
import { askAnthropic } from "./providers/anthropic.js";
import { askGemini } from "./providers/gemini.js";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 32 * 1024;
const MAX_MESSAGES = 12;
const MAX_MESSAGE_LENGTH = 8000;
const RATE_LIMIT_HEADERS = { "Retry-After": "60" };

function trustedClientIp(request) {
  // Cloudflare overwrites CF-Connecting-IP at its edge. Never use client-controlled
  // X-Forwarded-For / X-Real-IP headers as an identity source.
  const ip = request.headers.get("CF-Connecting-IP");
  return ip && ip.length <= 64 ? ip : null;
}

async function checkRateLimit(binding, key) {
  if (!binding || typeof binding.limit !== "function") return "unavailable";
  try {
    const result = await binding.limit({ key });
    if (result?.success === true) return "allowed";
    if (result?.success === false) return "limited";
    return "unavailable";
  } catch (error) {
    console.error("BEE rate limiter failed:", error?.message || "unknown error");
    return "unavailable";
  }
}

function rateLimitResponse(cors) {
  return json({ error: "Muitas requisições. Aguarde um minuto antes de tentar novamente." }, 429, { ...cors, ...RATE_LIMIT_HEADERS });
}

function rateLimitUnavailable(cors) {
  return json({ error: "Proteção temporariamente indisponível. Tente novamente em instantes." }, 503, cors);
}

function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
  if (origin && allowedOrigins(env).includes(origin.replace(/\/$/, ""))) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...cors }
  });
}

async function readJson(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_BODY_BYTES) throw new Error("Payload muito grande.");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new Error("Payload muito grande.");
  return JSON.parse(text);
}

function bearerToken(request) {
  const value = request.headers.get("Authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > MAX_MESSAGES) return false;
  return messages.every((message) =>
    message &&
    ["user", "assistant"].includes(message.role) &&
    typeof message.content === "string" &&
    message.content.trim().length > 0 &&
    message.content.length <= MAX_MESSAGE_LENGTH
  ) && messages[messages.length - 1].role === "user";
}

async function handleLogin(request, env, cors, options = {}) {
  const ip = options.clientIp ? options.clientIp(request) : trustedClientIp(request);
  if (!ip) return rateLimitUnavailable(cors);
  const limiter = options.loginRateLimiter ?? env.LOGIN_RATE_LIMITER;
  const rate = await checkRateLimit(limiter, `login:${ip}`);
  if (rate === "limited") return rateLimitResponse(cors);
  if (rate === "unavailable") return rateLimitUnavailable(cors);

  if (!env.BEE_ACCESS_CODE || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    return json({ error: "Autenticação não configurada: defina BEE_ACCESS_CODE e SESSION_SECRET (mínimo de 32 caracteres)." }, 503, cors);
  }
  let body;
  try { body = await readJson(request); } catch { return json({ error: "Requisição inválida." }, 400, cors); }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      typeof body.code !== "string" || body.code.length > 256 ||
      !(await constantTimeEqual(body.code.trim(), env.BEE_ACCESS_CODE))) {
    return json({ error: "Código de identificação incorreto." }, 401, cors);
  }
  const token = await createSession(env.SESSION_SECRET);
  return json({ token, expiresIn: 43200 }, 200, cors);
}

async function handleChat(request, env, cors, options = {}) {
  const token = bearerToken(request);
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32 ||
      !(await verifySession(token, env.SESSION_SECRET))) {
    return json({ error: "Sessão inválida ou expirada. Entre novamente." }, 401, cors);
  }

  const limiter = options.chatRateLimiter ?? env.CHAT_RATE_LIMITER;
  // Preserve the existing Cloudflare key; Vercel supplies a SHA-256 session key.
  const chatKey = options.chatIdentifier ? await options.chatIdentifier(token) : "bee-user:chat";
  if (typeof chatKey !== "string" || !chatKey) return rateLimitUnavailable(cors);
  const rate = await checkRateLimit(limiter, chatKey);
  if (rate === "limited") return rateLimitResponse(cors);
  if (rate === "unavailable") return rateLimitUnavailable(cors);

  let body;
  try { body = await readJson(request); } catch { return json({ error: "Corpo da requisição inválido ou muito grande." }, 400, cors); }
  if (!validateMessages(body.messages)) {
    return json({ error: "Envie até 12 mensagens válidas; a última deve ser do usuário." }, 400, cors);
  }

  const preferred = chooseProvider(body.messages);
  const order = getProviderOrder(preferred, env);
  if (!order.length) return json({ error: "Nenhuma IA está configurada. Adicione OPENAI_API_KEY, ANTHROPIC_API_KEY ou GEMINI_API_KEY nos secrets." }, 503, cors);

  const adapters = { openai: askOpenAI, anthropic: askAnthropic, gemini: askGemini };
  for (const provider of order) {
    try {
      const answer = await adapters[provider](body.messages, env);
      return json({ answer, provider }, 200, cors);
    } catch (error) {
      console.error(`BEE provider ${provider} failed:`, error?.message || "unknown error");
    }
  }
  return json({ error: "As IAs configuradas não conseguiram responder. Tente novamente em instantes." }, 502, cors);
}

export async function handleRequest(request, env = {}, options = {}) {
    const cors = corsHeaders(request, env);
    const origin = request.headers.get("Origin");
    if (origin && !allowedOrigins(env).includes(origin.replace(/\/$/, ""))) {
      return json({ error: "Origem não autorizada." }, 403, cors);
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({ status: "ok", service: "bee-api" }, 200, cors);
    }
    if (request.method === "POST" && url.pathname === "/api/auth/login") {
      return handleLogin(request, env, cors, options);
    }
    if (request.method === "POST" && url.pathname === "/api/chat") {
      return handleChat(request, env, cors, options);
    }
    return json({ error: "Rota não encontrada." }, 404, cors);
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  }
};
