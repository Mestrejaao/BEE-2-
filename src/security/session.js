const encoder = new TextEncoder();

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function isValidSessionId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(value)) return false;
  try {
    const decoded = fromBase64Url(value);
    return decoded.byteLength === 16 && toBase64Url(decoded) === value;
  } catch {
    return false;
  }
}

async function getSigningKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function createSession(secret, now = Date.now()) {
  // A random per-session identifier prevents tokens created in the same
  // second from colliding (the payload is signed together with this nonce).
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  const payload = {
    sub: "bee-user",
    jti: toBase64Url(nonce),
    exp: Math.floor(now / 1000) + 60 * 60 * 12
  };
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await getSigningKey(secret),
    encoder.encode(body)
  );
  return body + "." + toBase64Url(new Uint8Array(signature));
}

export async function verifySession(token, secret, now = Date.now()) {
  if (!token || !secret || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;

  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await getSigningKey(secret),
      fromBase64Url(parts[1]),
      encoder.encode(parts[0])
    );
    if (!valid) return false;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0])));
    return payload.sub === "bee-user" &&
      isValidSessionId(payload.jti) &&
      Number.isInteger(payload.exp) &&
      payload.exp > Math.floor(now / 1000);
  } catch {
    return false;
  }
}

export async function constantTimeEqual(left, right) {
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(left))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(right)))
  ]);
  const aa = new Uint8Array(a);
  const bb = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < aa.length; index += 1) difference |= aa[index] ^ bb[index];
  return difference === 0;
}
