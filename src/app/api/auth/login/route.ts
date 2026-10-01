import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  consumeChallenge,
  getUserByUsername,
  verifySignature,
  createSession,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth";

export const runtime = "nodejs";

// Simple in-memory rate limiter: max 10 failed attempts per IP per 15 min.
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function limited(ip: string): boolean {
  const rec = attempts.get(ip);
  return !!rec && rec.resetAt > Date.now() && rec.count >= MAX_ATTEMPTS;
}
function fail(ip: string) {
  const rec = attempts.get(ip);
  if (!rec || rec.resetAt < Date.now()) attempts.set(ip, { count: 1, resetAt: Date.now() + WINDOW_MS });
  else rec.count += 1;
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "local";
  if (limited(ip)) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const { challengeId, signature } = await req.json();
  const challenge = challengeId ? consumeChallenge(String(challengeId)) : null;
  if (!challenge || !signature) {
    fail(ip);
    return NextResponse.json({ error: "Invalid or expired challenge" }, { status: 401 });
  }

  const user = getUserByUsername(challenge.username);
  const ok =
    !!user?.public_key &&
    verifySignature(user.public_key, challenge.nonce, String(signature));

  if (!user || !ok) {
    fail(ip);
    return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
  }

  attempts.delete(ip);
  db().prepare(`UPDATE users SET last_login_at=? WHERE id=?`).run(new Date().toISOString(), user.id);
  const cookie = createSession(user.id, req.headers.get("user-agent") || undefined);
  const res = NextResponse.json({ ok: true, username: user.username });
  res.cookies.set(SESSION_COOKIE, cookie, sessionCookieOptions);
  return res;
}
