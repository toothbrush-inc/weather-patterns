// Two optional gates, both no-ops unless configured:
//
// 1. WEATHER_IDENTITY_HEADER — under the platform gateway, Caddy verifies the
//    session and forwards the signed-in email in this header (see
//    lib/identity.mjs). Once the variable is set a request without the header
//    did not come through Caddy, so it is refused rather than served the shared
//    anonymous view.
// 2. SITE_PASSWORD — site-wide password (HTTP Basic Auth) for a lone instance on
//    a public URL.
//
// A private deployment (Tailscale, Cloudflare Access, LAN) sets neither and pays
// no auth tax. Set SITE_PASSWORD whenever the instance has a public URL — a PaaS deploy, a
// Tailscale Funnel, a raw open port — to keep strangers and bots out: without it,
// anyone who reaches the URL can rewrite your keys and locations via the POST
// endpoints. Single-tenant ≠ private.
//
// Next 16 renamed `middleware.ts` → `proxy.ts` (exported fn `middleware` → `proxy`);
// the matcher config is unchanged. For cron hitting /api/collect on a protected
// instance, embed credentials in the URL (https://user:pass@host/api/collect) or
// rely on the built-in scheduler instead.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(req: NextRequest) {
  const identityHeader = (process.env.WEATHER_IDENTITY_HEADER || "").trim();
  if (identityHeader && !(req.headers.get(identityHeader) || "").trim()) {
    return new NextResponse("Sign in through the platform front door.", { status: 401 });
  }

  const password = process.env.SITE_PASSWORD;
  if (!password) return NextResponse.next(); // password auth disabled

  const header = req.headers.get("authorization") || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    let decoded = "";
    try {
      decoded = atob(encoded);
    } catch {
      decoded = "";
    }
    // Credentials are "user:pass"; the username is ignored, only the password matters.
    const sep = decoded.indexOf(":");
    const supplied = sep === -1 ? decoded : decoded.slice(sep + 1);
    if (supplied && timingSafeEqual(supplied, password)) return NextResponse.next();
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="weather-patterns", charset="UTF-8"' },
  });
}

// Best-effort constant-time compare. The real protection is HTTPS + a strong
// password; this just avoids handing out a trivial timing oracle.
function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const config = {
  // Protect pages + API; let Next's build assets through (the browser resends
  // credentials to them once authenticated anyway). The bare "/" entry matters
  // under basePath: the pattern below compiles to /weather/(...) and so never
  // matched the root page at /weather itself, which slipped past both gates.
  matcher: ["/", "/((?!_next/static|_next/image|favicon.ico).*)"],
};
