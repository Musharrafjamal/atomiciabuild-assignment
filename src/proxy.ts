import { NextResponse, type NextRequest } from "next/server";
import { verifySession } from "@/lib/auth/token";

const SESSION_COOKIE = "clinic_session";

/**
 * Optimistic routing only.
 *
 * This sends signed-out visitors to the login page and keeps staff from landing
 * on a manager screen they would only be refused by anyway. It is **not** the
 * authorisation boundary -- Next's documentation is explicit that Proxy should not
 * be used as one, and every mutating route calls requireUser/requireManager for
 * itself. Deleting this file would cost polish, not safety.
 *
 * Session verification here uses jose, which runs on Web Crypto and therefore
 * works in this runtime; bcrypt would not, which is why no password work happens
 * at this layer.
 */

const MANAGER_PREFIXES = ["/dashboard", "/import"];
const PUBLIC_PATHS = ["/login"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const session = await verifySession(
    request.cookies.get(SESSION_COOKIE)?.value,
  );

  if (!session) {
    if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();
    const login = new URL("/login", request.url);
    // Preserve where they were heading so login can send them back.
    if (pathname !== "/") login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  // Signed in: keep them off the login page.
  if (PUBLIC_PATHS.includes(pathname)) {
    return NextResponse.redirect(new URL(homeFor(session.role), request.url));
  }

  if (
    session.role !== "manager" &&
    MANAGER_PREFIXES.some((p) => pathname.startsWith(p))
  ) {
    return NextResponse.redirect(new URL("/shifts", request.url));
  }

  return NextResponse.next();
}

function homeFor(role: "manager" | "staff"): string {
  return role === "manager" ? "/dashboard" : "/shifts";
}

export const config = {
  /**
   * Skip API routes (they answer with JSON errors rather than redirects), Next's
   * internals, and static files.
   */
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
