import { NextResponse } from "next/server";
import { currentUser, hasKeyAdmin } from "@/lib/auth";

export const runtime = "nodejs";

// Public endpoint (allowed by middleware) so login/setup can decide what to render.
export async function GET() {
  const user = currentUser();
  return NextResponse.json({ user, needsSetup: !hasKeyAdmin() });
}
