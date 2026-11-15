import { createSession, verifySession, constantTimeEqual } from "./security/session.js";
import { chooseProvider, getProviderOrder } from "./router/selector.js";
import { askOpenAI } from "./providers/openai.js";
import { askAnthropic } from "./providers/anthropic.js";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 32 * 1024;
const MAX_MESSAGES = 12;
const MAX_MESSAGE_LENGTH = 8000;

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

async function handleLogin(request, env, cors) {
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

async function handleChat(request, env, cors) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32 ||
      !(await verifySession(bearerToken(request), env.SESSION_SECRET))) {
    return json({ error: "Sessão inválida ou expirada. Entre novamente." }, 401, cors);
  }

  let body;
  try { body = await readJson(request); } catch { return json({ error: "Corpo da requisição inválido ou muito grande." }, 400, cors); }
  if (!validateMessages(body.messages)) {
    return json({ error: "Envie até 12 mensagens válidas; a última deve ser do usuário." }, 400, cors);
  }

  const preferred = chooseProvider(body.messages);
  const order = getProviderOrder(preferred, env);
  if (!order.length) return json({ error: "Nenhuma IA está configurada. Adicione OPENAI_API_KEY ou ANTHROPIC_API_KEY nos secrets." }, 503, cors);

  const adapters = { openai: askOpenAI, anthropic: askAnthropic };
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

export default {
  async fetch(request, env) {
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
      return handleLogin(request, env, cors);
    }
    if (request.method === "POST" && url.pathname === "/api/chat") {
      return handleChat(request, env, cors);
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return json({ error: "Rota não encontrada." }, 404, cors);
  }
};
