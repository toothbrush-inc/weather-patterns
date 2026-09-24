// Who is asking? Under the platform gateway, Caddy verifies the browser session
// and forwards the signed-in email as a trusted header (platform-deploy's
// Caddyfile: forward_auth + copy_headers); WEATHER_IDENTITY_HEADER names that
// header. Unset, the instance is single-tenant and every request is anonymous —
// the original behaviour, with nothing per user.
//
// The header is trusted on the strength of the proxy alone. That holds because
// Caddy strips any client-supplied copy before forward_auth and only the
// gateway's 2xx can set it — and because proxy.ts refuses requests missing it
// once the variable is set, so a request that somehow reached Next without
// passing Caddy fails closed instead of falling back to the shared view.

export function identityHeaderName(env = process.env) {
  return String(env.WEATHER_IDENTITY_HEADER || "").trim().toLowerCase();
}

export function identityEnabled(env = process.env) {
  return identityHeaderName(env) !== "";
}

// Path-safe key for a user's own data. Same rule as the gateway's userSlug, so
// a weather user file lines up with the platform's /data/users/<slug>/:
// alice@example.com -> alice_at_example_com. Null when nothing survives.
export function userSlug(user) {
  const slug = String(user ?? "")
    .trim()
    .toLowerCase()
    .replace(/@/g, "_at_")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96);
  return slug || null;
}

// The caller behind a request: { id, email }, or null when identity is off or
// the header is missing/empty. `headers` is anything with .get(name) — a Fetch
// Headers works. Never throws.
export function callerFromHeaders(headers, env = process.env) {
  const name = identityHeaderName(env);
  if (!name) return null;
  const raw = String(headers?.get?.(name) || "").trim().toLowerCase();
  const id = userSlug(raw);
  return id ? { id, email: raw } : null;
}
