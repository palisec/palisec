import { NextResponse, type NextRequest } from "next/server";

/**
 * The console needs a session: console pages without a session cookie go to /login, which returns
 * the visitor to the page they asked for after sign-in. Public pages, including the overview at `/`,
 * are open to everyone.
 *
 * This only reads whether the cookie exists, so it never touches the database. It is a convenience,
 * not the security boundary: every API request verifies the session server-side, and a console page
 * with an expired cookie is sent back to /login by the console itself.
 */
const SESSION_COOKIES = ["__Host-ps_session", "ps_session"];

export function proxy(req: NextRequest) {
  const hasSession = SESSION_COOKIES.some((n) => /^[0-9a-f]{64}$/.test(req.cookies.get(n)?.value ?? ""));
  if (hasSession) return NextResponse.next();
  const { pathname, search } = req.nextUrl;
  const login = new URL("/login", req.url);
  login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/console", "/console/:path*"],
};
