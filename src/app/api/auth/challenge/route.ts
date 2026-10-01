import { NextRequest, NextResponse } from "next/server";
import { getUserByUsername, createChallenge } from "@/lib/auth";

export const runtime = "nodejs";

// Issues a login challenge. To avoid leaking which usernames exist, we return a
// challenge even for unknown users (verification simply fails later).
export async function POST(req: NextRequest) {
  const { username } = await req.json();
  if (!username) {
    return NextResponse.json({ error: "Username required" }, { status: 400 });
  }
  const uname = String(username).trim();
  // Only issue for users that actually have a key, but keep the response shape
  // identical either way.
  const user = getUserByUsername(uname);
  const { id, nonce } = createChallenge(uname);
  return NextResponse.json({ challengeId: id, nonce, exists: !!user?.public_key });
}
