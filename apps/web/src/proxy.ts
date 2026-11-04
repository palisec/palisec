import { NextResponse, type NextRequest } from "next/server";

/**
 * Entry routing. The app starts at sign-in: `/` and every console page send visitors without a
 * session cookie to /login, and send signed-in members from `/` to the console.
 *
 * This only reads whether the cookie exists, so it never touches the database. It is a convenience,
 * not the security boundary: every API request verifies the session server-side, and a console page
 * with an expired cookie is sent back to /login by the console itself.
 */
const SESSION_COOKIES = ["__Host-rw_session", "rw_session"];

export function proxy(req: NextRequest) {
  const hasSession = SESSION_COOKIES.some((n) => /^[0-9a-f]{64}$/.test(req.cookies.get(n)?.value ?? ""));
  const { pathname, search } = req.nextUrl;
  if (pathname === "/") return NextResponse.redirect(new URL(hasSession ? "/console" : "/login", req.url));
  if (!hasSession) {
    const login = new URL("/login", req.url);
    login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/console", "/console/:path*"],
};
