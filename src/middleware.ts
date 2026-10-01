import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth-constants";
import { isValidSessionCookie } from "@/lib/auth-edge";

// Paths that never require authentication.
const PUBLIC_PATHS = ["/login", "/setup"];
const PUBLIC_API = ["/api/auth/"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isPublicPage = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const isPublicApi = PUBLIC_API.some((p) => pathname.startsWith(p));
  if (isPublicPage || isPublicApi) return NextResponse.next();

  const authed = await isValidSessionCookie(req.cookies.get(SESSION_COOKIE)?.value);
  if (authed) return NextResponse.next();

  // Unauthenticated: 401 for API, redirect to /login for pages.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("from", pathname);
  return NextResponse.redirect(url);
}

// Run on everything except Next internals and static assets.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
