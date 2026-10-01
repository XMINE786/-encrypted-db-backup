// Edge-runtime-safe verification of the signed session cookie, for use in
// middleware. It only checks the HMAC signature + expiry (stateless). Full
// DB-backed session validation happens server-side in currentUser().

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

async function hmacHex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toHex(sig);
}

async function edgeSecret(): Promise<string> {
  const explicit = process.env.AUTH_SECRET;
  if (explicit && explicit.length >= 8) return explicit;
  const base = process.env.BACKUP_ENCRYPTION_KEY || "";
  return sha256Hex("auth:" + base);
}

function base64urlToString(b64url: string): string {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  // atob is available in the edge runtime.
  const bin = atob(b64 + pad);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Returns true if the cookie value is a validly-signed, unexpired session. */
export async function isValidSessionCookie(value: string | undefined): Promise<boolean> {
  if (!value) return false;
  const dot = value.lastIndexOf(".");
  if (dot < 0) return false;
  const payloadB64 = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  try {
    const expected = await hmacHex(payloadB64, await edgeSecret());
    if (!timingSafeEqualStr(sig, expected)) return false;
    const payload = JSON.parse(base64urlToString(payloadB64)) as { e?: number };
    return !!payload.e && payload.e > Date.now();
  } catch {
    return false;
  }
}
