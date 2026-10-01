"use client";

// Browser-side ECDSA P-256 helpers. The private key is generated, used, and
// stored ONLY on the user's device — it is never sent to the server.
//
// This uses a pure-JS implementation (@noble/curves) instead of the Web Crypto
// API (crypto.subtle) so it works in ANY browser context — including plain
// HTTP on a LAN IP, where browsers disable crypto.subtle and crypto.randomUUID.
// Output formats are byte-identical to the old WebCrypto path:
//   - public key: SPKI DER, base64
//   - signature:  raw r||s (IEEE-P1363), base64, over SHA-256(nonce)
//   - key file:   private key stored as a standard EC JWK
// so existing key files and the server-side verifier (see lib/auth.ts) keep
// working unchanged.

import { p256 } from "@noble/curves/p256";
import { sha256 } from "@noble/hashes/sha256";

// Kept for backward-compat with older callers; crypto now works over HTTP too,
// so this message is no longer shown in practice.
export const INSECURE_CONTEXT_MSG =
  "Your browser could not provide secure randomness. Try a modern browser.";

/**
 * Crypto is available whenever the browser exposes getRandomValues — which it
 * does in every context, secure or not (unlike crypto.subtle). We keep the
 * function so existing UI gating code compiles; it now effectively always true
 * in a real browser.
 */
export function isCryptoAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.crypto !== "undefined" &&
    typeof window.crypto.getRandomValues === "function"
  );
}

function requireCrypto() {
  if (!isCryptoAvailable()) throw new Error(INSECURE_CONTEXT_MSG);
}

// ---- byte / base64 helpers ----
function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToB64Url(bytes: Uint8Array): string {
  return bytesToB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  return b64ToBytes(b64 + pad);
}

// ---- SPKI DER (un)wrapping for an EC P-256 uncompressed public point ----
// Fixed 26-byte SPKI header for id-ecPublicKey + prime256v1, followed by the
// BIT STRING containing the 65-byte uncompressed point (0x04 || X || Y).
const SPKI_P256_PREFIX = new Uint8Array([
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
  0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
]);

function spkiFromPoint(point65: Uint8Array): Uint8Array {
  const out = new Uint8Array(SPKI_P256_PREFIX.length + point65.length);
  out.set(SPKI_P256_PREFIX, 0);
  out.set(point65, SPKI_P256_PREFIX.length);
  return out;
}

/** Extract the 65-byte uncompressed point from an SPKI DER key; throws if malformed. */
function pointFromSpki(spki: Uint8Array): Uint8Array {
  if (spki.length !== SPKI_P256_PREFIX.length + 65) {
    throw new Error("Unexpected SPKI length for an EC P-256 key.");
  }
  const point = spki.slice(SPKI_P256_PREFIX.length);
  if (point[0] !== 0x04) throw new Error("Expected an uncompressed EC point.");
  // Validate the point is actually on the curve.
  p256.ProjectivePoint.fromHex(point);
  return point;
}

/** Generate a random key id (UUID v4) without crypto.randomUUID (unavailable over HTTP). */
export function randomKeyId(): string {
  const b = new Uint8Array(16);
  window.crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface KeyFile {
  app: "DevGems";
  type: "devgems-private-key";
  username: string;
  keyId: string;
  alg: "ES256";
  createdAt: string;
  privateKey: JsonWebKey;
  publicKeySpki: string; // base64
}

/** Generate a keypair and produce both the SPKI public key and a downloadable key file. */
export async function generateKeyMaterial(
  username: string
): Promise<{ publicKey: string; keyId: string; keyFile: KeyFile }> {
  requireCrypto();
  const priv = p256.utils.randomPrivateKey(); // 32 bytes
  const point = p256.getPublicKey(priv, false); // 65-byte uncompressed point
  const spki = spkiFromPoint(point);
  const spkiB64 = bytesToB64(spki);

  const x = point.slice(1, 33);
  const y = point.slice(33, 65);
  const privateJwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: bytesToB64Url(x),
    y: bytesToB64Url(y),
    d: bytesToB64Url(priv),
    ext: true,
    key_ops: ["sign"],
  };

  const keyId = randomKeyId();
  const keyFile: KeyFile = {
    app: "DevGems",
    type: "devgems-private-key",
    username,
    keyId,
    alg: "ES256",
    createdAt: new Date().toISOString(),
    privateKey: privateJwk,
    publicKeySpki: spkiB64,
  };
  return { publicKey: spkiB64, keyId, keyFile };
}

/** Trigger a browser download of the key file. */
export function downloadKeyFile(keyFile: KeyFile) {
  const blob = new Blob([JSON.stringify(keyFile, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `devgems-${keyFile.username}.key.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Read + validate a key file selected by the user. */
export async function parseKeyFile(file: File): Promise<KeyFile> {
  const text = await file.text();
  const data = JSON.parse(text) as KeyFile;
  if (data?.type !== "devgems-private-key" || !data.privateKey || !data.username) {
    throw new Error("This doesn't look like a DevGems key file.");
  }
  return data;
}

/** Sign a base64 nonce with the private key from a key file. Returns base64 signature (raw r||s). */
export async function signNonce(privateJwk: JsonWebKey, nonceB64: string): Promise<string> {
  requireCrypto();
  if (!privateJwk?.d) throw new Error("Key file is missing the private key.");
  const priv = b64UrlToBytes(privateJwk.d);
  const msgHash = sha256(b64ToBytes(nonceB64));
  const sig = p256.sign(msgHash, priv); // lowS by default; standard ECDSA
  return bytesToB64(sig.toCompactRawBytes()); // 64-byte r||s == IEEE-P1363
}

/** Validate a pasted SPKI public key (base64) in the browser. */
export async function isValidPublicKeyClient(spkiB64: string): Promise<boolean> {
  try {
    pointFromSpki(b64ToBytes(spkiB64));
    return true;
  } catch {
    return false;
  }
}
