import { NextRequest, NextResponse } from "next/server";
import {
  hasKeyAdmin,
  isValidPublicKey,
  createUserWithKey,
  createSession,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth";
import { ALL_PERMS } from "@/lib/permissions";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // First-run only: refuse once a key-based admin exists.
  if (hasKeyAdmin()) {
    return NextResponse.json({ error: "Setup already completed" }, { status: 403 });
  }
  const { username, publicKey, keyId } = await req.json();
  if (!username || username.length < 3) {
    return NextResponse.json({ error: "Username must be at least 3 characters" }, { status: 400 });
  }
  if (!publicKey || !isValidPublicKey(publicKey)) {
    return NextResponse.json({ error: "A valid ECDSA P-256 public key is required" }, { status: 400 });
  }

  const user = createUserWithKey({
    username: String(username).trim(),
    publicKey,
    keyId: keyId || "",
    isAdmin: true,
    permissions: ALL_PERMS,
  });
  // Trusted first-run: establish the session immediately (the admin just
  // registered the key that pairs with the file they downloaded).
  const cookie = createSession(user.id, req.headers.get("user-agent") || undefined);
  const res = NextResponse.json({ ok: true, username: user.username });
  res.cookies.set(SESSION_COOKIE, cookie, sessionCookieOptions);
  return res;
}
