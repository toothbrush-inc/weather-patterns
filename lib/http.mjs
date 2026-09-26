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

// Every upstream call is bounded. A collection holds the collection lock for its
// whole run (see lib/collect.mjs), so one provider that accepts the connection
// and never answers would otherwise stall that run — and every tick queued behind
// it — indefinitely. A timed-out call fails like any other HTTP error: that
// source is stored as an error row and the rest of the snapshot goes ahead.
export const FETCH_TIMEOUT_MS = 15_000;

function timeoutError(url, ms) {
  const error = new Error(`timed out after ${ms / 1000}s for ${hostOf(url)}`);
  error.code = "timeout";
  return error;
}

// Bound a promise we cannot abort (e.g. a call into another package) by racing
// it against a timer. The underlying work is abandoned, not cancelled.
export async function withTimeout(promise, url, ms = FETCH_TIMEOUT_MS) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(timeoutError(url, ms)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function getJSON(url, headers = {}, { timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  // The signal also covers reading the body, so a response that stalls midway
  // is cut off too, not just one that never starts.
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, ...headers },
      cache: "no-store", // always hit the network; we do our own history storage
      signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} for ${hostOf(url)}${body ? `: ${body.slice(0, 160)}` : ""}`);
    }
    return await res.json();
  } catch (error) {
    if (signal.aborted) throw timeoutError(url, timeoutMs);
    throw error;
  }
}
