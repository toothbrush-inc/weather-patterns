// Shared JSON fetch helper. Sends a descriptive User-Agent (required by NWS and
// polite for the other APIs) and turns non-2xx responses into informative errors.
// Used by sources.mjs (current conditions) and forecast.mjs (daily forecast).

export const UA = "weather-patterns/1.0 (personal weather service)";

// Open-Meteo commercial keys use customer-* hosts plus ?apikey=. The public URL
// is what we persist/show; the keyed URL is only used for the fetch so the key
// never lands in history.json or tool results.
const OPEN_METEO_CUSTOMER_HOSTS = {
  "api.open-meteo.com": "customer-api.open-meteo.com",
  "air-quality-api.open-meteo.com": "customer-air-quality-api.open-meteo.com",
  "archive-api.open-meteo.com": "customer-archive-api.open-meteo.com",
};

export function withOpenMeteoKey(url, apiKey) {
  if (!apiKey) return url;
  const u = new URL(url);
  const customer = OPEN_METEO_CUSTOMER_HOSTS[u.host];
  if (customer) u.host = customer;
  u.searchParams.set("apikey", apiKey);
  return u.toString();
}

function hostOf(url) {
  try { return new URL(url).host; } catch { return url; }
}

export async function getJSON(url, headers = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, ...headers },
    cache: "no-store", // always hit the network; we do our own history storage
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} for ${hostOf(url)}${body ? `: ${body.slice(0, 160)}` : ""}`);
  }
  return res.json();
}
