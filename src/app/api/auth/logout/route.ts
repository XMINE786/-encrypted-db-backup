import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, decodeCookie, destroySession } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  if (raw) {
    const payload = decodeCookie(raw);
    if (payload) destroySession(payload.t);
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
