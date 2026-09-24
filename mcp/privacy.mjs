// Strip secrets from MCP tool payloads. Weather locations and readings ARE the
// product (unlike calsync, where event titles/locations are forbidden). Keys,
// tokens, and password-like fields never leave the process.

const FORBIDDEN_KEYS = new Set([
  "readkey",
  "apikey",
  "api_key",
  "token",
  "tokens",
  "authorization",
  "credentials",
  "password",
  "sitepassword",
  "collecttoken",
  "purpleairreadkey",
  "openmeteoapikey",
  "clientsecret",
  "clientid",
]);

const TOKEN_LIKE =
  /\b(?:ya29\.|pk_live_|sk_live_|X-API-Key|PURPLEAIR_READ_KEY|OPEN_METEO_API_KEY)\b/i;

export function sanitizeToolPayload(value) {
  return sanitizeValue(value);
}

function sanitizeValue(value) {
  if (typeof value === "string") {
    return TOKEN_LIKE.test(value) ? "[redacted]" : value;
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
  }
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(normalizeKey(key))) continue;
    result[key] = sanitizeValue(entry);
  }
  return result;
}

function normalizeKey(key) {
  return key.replaceAll(/[^A-Za-z0-9]/g, "").toLowerCase();
}

export function toJsonPayload(value) {
  const sanitized = sanitizeToolPayload(value);
  if (typeof sanitized === "object" && sanitized !== null && !Array.isArray(sanitized)) {
    return sanitized;
  }
  return { value: sanitized };
}
