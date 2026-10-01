import crypto from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db, UserRow, ChallengeRow } from "./db";
import { SESSION_COOKIE } from "./auth-constants";
import {
  PermissionSet,
  effectivePerms,
  normalizePerms,
} from "./permissions";

export { SESSION_COOKIE };
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CHALLENGE_TTL_MS = 2 * 60 * 1000; // 2 minutes

// ---- Secret used to sign session cookies (HMAC) ----
export function authSecret(): string {
  const explicit = process.env.AUTH_SECRET;
  if (explicit && explicit.length >= 8) return explicit;
  // Fall back to a value derived from the encryption key so there's always a
  // stable secret without extra config.
  const base = process.env.BACKUP_ENCRYPTION_KEY || "";
  if (base.length < 8) {
    throw new Error("Set AUTH_SECRET or BACKUP_ENCRYPTION_KEY before using auth.");
  }
  return crypto.createHash("sha256").update("auth:" + base).digest("hex");
}

// ---- Key-based auth (ECDSA P-256, challenge/response) ----

/** Fingerprint a public key (SPKI base64) for display, e.g. "ab:cd:…". */
export function fingerprint(spkiB64: string): string {
  const hash = crypto.createHash("sha256").update(Buffer.from(spkiB64, "base64")).digest("hex");
  return hash.slice(0, 32).match(/.{2}/g)!.join(":");
}

/** Validate that a string is a usable ECDSA P-256 SPKI public key. */
export function isValidPublicKey(spkiB64: string): boolean {
  try {
    const key = crypto.createPublicKey({
      key: Buffer.from(spkiB64, "base64"),
      format: "der",
      type: "spki",
    });
    return key.asymmetricKeyType === "ec";
  } catch {
    return false;
  }
}

/**
 * Verify a WebCrypto ECDSA signature (IEEE-P1363 / raw r||s) over `nonce`
 * against a stored SPKI public key. All inputs base64.
 */
export function verifySignature(spkiB64: string, nonceB64: string, signatureB64: string): boolean {
  try {
    const pub = crypto.createPublicKey({
      key: Buffer.from(spkiB64, "base64"),
      format: "der",
      type: "spki",
    });
    return crypto.verify(
      "sha256",
      Buffer.from(nonceB64, "base64"),
      { key: pub, dsaEncoding: "ieee-p1363" },
      Buffer.from(signatureB64, "base64")
    );
  } catch {
    return false;
  }
}

/** Create a short-lived login challenge for a username. */
export function createChallenge(username: string): { id: string; nonce: string } {
  const id = crypto.randomBytes(16).toString("hex");
  const nonce = crypto.randomBytes(32).toString("base64");
  db()
    .prepare(`INSERT INTO auth_challenges (id, username, nonce, expires_at) VALUES (?, ?, ?, ?)`)
    .run(id, username, nonce, new Date(Date.now() + CHALLENGE_TTL_MS).toISOString());
  return { id, nonce };
}

/** Fetch + delete a challenge (single use). Returns null if missing/expired. */
export function consumeChallenge(id: string): ChallengeRow | null {
  const row = db().prepare(`SELECT * FROM auth_challenges WHERE id=?`).get(id) as
    | ChallengeRow
    | undefined;
  if (row) db().prepare(`DELETE FROM auth_challenges WHERE id=?`).run(id);
  // Opportunistic cleanup of expired challenges.
  db().prepare(`DELETE FROM auth_challenges WHERE expires_at < ?`).run(new Date().toISOString());
  if (!row || new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

// ---- Signed-cookie encoding (payload.signature) ----
interface CookiePayload {
  t: string; // session token
  u: number; // user id
  e: number; // expiry (ms epoch)
}

function sign(payloadB64: string): string {
  return crypto.createHmac("sha256", authSecret()).update(payloadB64).digest("hex");
}

function encodeCookie(p: CookiePayload): string {
  const payloadB64 = Buffer.from(JSON.stringify(p)).toString("base64url");
  return `${payloadB64}.${sign(payloadB64)}`;
}

export function decodeCookie(value: string): CookiePayload | null {
  const dot = value.lastIndexOf(".");
  if (dot < 0) return null;
  const payloadB64 = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = sign(payloadB64);
  // Constant-time signature check.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(payloadB64, "base64url").toString()) as CookiePayload;
    if (!p.t || !p.u || !p.e || p.e < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

// ---- Users ----

/** True once at least one key-based admin exists (setup complete). */
export function hasKeyAdmin(): boolean {
  const row = db()
    .prepare(`SELECT COUNT(*) AS n FROM users WHERE is_admin=1 AND public_key IS NOT NULL`)
    .get() as { n: number };
  return row.n > 0;
}

export function getUserByUsername(username: string): UserRow | undefined {
  return db().prepare(`SELECT * FROM users WHERE username=?`).get(username) as
    | UserRow
    | undefined;
}

export function getUserById(id: number): UserRow | undefined {
  return db().prepare(`SELECT * FROM users WHERE id=?`).get(id) as UserRow | undefined;
}

export function listUsers(): UserRow[] {
  return db().prepare(`SELECT * FROM users ORDER BY is_admin DESC, username COLLATE NOCASE`).all() as UserRow[];
}

export function countAdmins(): number {
  return (db().prepare(`SELECT COUNT(*) AS n FROM users WHERE is_admin=1`).get() as { n: number }).n;
}

export function createUserWithKey(opts: {
  username: string;
  publicKey: string;
  keyId: string;
  isAdmin: boolean;
  permissions: PermissionSet;
}): UserRow {
  const now = new Date().toISOString();
  const info = db()
    .prepare(
      `INSERT INTO users (username, public_key, key_id, fingerprint, is_admin, permissions, created_at)
       VALUES (@username, @public_key, @key_id, @fingerprint, @is_admin, @permissions, @now)`
    )
    .run({
      username: opts.username,
      public_key: opts.publicKey,
      key_id: opts.keyId,
      fingerprint: fingerprint(opts.publicKey),
      is_admin: opts.isAdmin ? 1 : 0,
      permissions: JSON.stringify(normalizePerms(opts.permissions)),
      now,
    });
  return getUserById(Number(info.lastInsertRowid))!;
}

export function updateUser(
  id: number,
  patch: { username?: string; isAdmin?: boolean; permissions?: PermissionSet }
): void {
  const u = getUserById(id);
  if (!u) return;
  db()
    .prepare(`UPDATE users SET username=?, is_admin=?, permissions=? WHERE id=?`)
    .run(
      patch.username ?? u.username,
      (patch.isAdmin ?? !!u.is_admin) ? 1 : 0,
      patch.permissions ? JSON.stringify(normalizePerms(patch.permissions)) : u.permissions,
      id
    );
}

export function deleteUser(id: number): void {
  db().prepare(`DELETE FROM users WHERE id=?`).run(id);
}

// ---- Sessions ----
export function createSession(userId: number, userAgent?: string): string {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO sessions (token, user_id, created_at, expires_at, user_agent)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      token,
      userId,
      new Date(now).toISOString(),
      new Date(now + SESSION_TTL_MS).toISOString(),
      userAgent || null
    );
  return encodeCookie({ t: token, u: userId, e: now + SESSION_TTL_MS });
}

export function destroySession(token: string) {
  db().prepare(`DELETE FROM sessions WHERE token=?`).run(token);
}

export interface CurrentUser {
  id: number;
  username: string;
  isAdmin: boolean;
  permissions: PermissionSet;
}

/** Resolve the current user from the request cookie, validating against the DB. */
export function currentUser(): CurrentUser | null {
  const raw = cookies().get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const payload = decodeCookie(raw);
  if (!payload) return null;

  const session = db()
    .prepare(`SELECT * FROM sessions WHERE token=?`)
    .get(payload.t) as { user_id: number; expires_at: string } | undefined;
  if (!session || new Date(session.expires_at).getTime() < Date.now()) return null;

  const user = getUserById(session.user_id);
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    isAdmin: !!user.is_admin,
    permissions: effectivePerms(!!user.is_admin, user.permissions),
  };
}

/**
 * Guard for API routes. Returns the current user if they hold `perm`
 * (admins always pass), otherwise a NextResponse to return directly.
 */
export function requirePermission(
  perm: keyof PermissionSet
): { user: CurrentUser } | { error: NextResponse } {
  const user = currentUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!user.permissions[perm]) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  // `Secure` cookies are dropped by browsers over plain HTTP. Set
  // ALLOW_INSECURE_COOKIES=1 to serve over HTTP on a trusted/internal network.
  // Leave it unset in any internet-facing deployment and terminate HTTPS.
  secure:
    process.env.ALLOW_INSECURE_COOKIES === "1"
      ? false
      : process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_TTL_MS / 1000,
};
