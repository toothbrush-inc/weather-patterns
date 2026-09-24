// Heads-up alerts: is anything about TODAY outside this location's normal?
// Rain/storms, unusual wind, bad air, an abnormal high/low — plus any official
// NWS advisory in effect. "Normal" is derived from the location's own collected
// history (the app's local ground truth), not generic climatology, so a windy
// ridge and a sheltered valley each get their own baseline. Quiet day → [].
//
// Each alert: { kind, severity: "warning"|"notice", icon, headline, detail }.

import { getReadings } from "./db.mjs";
import { getJSON } from "./http.mjs";
import { providerGetJSON } from "./provider-http.mjs";
import { RAIN_PROB } from "./constants.mjs"; // % chance that counts as "rain today" (shared with the dashboard icon)

// Absolute floors (an event is an event even with no history yet) …
const RAIN_PROB_HIGH = 70;
const RAIN_IN = 0.05; // inches expected that counts even at lower probability
const RAIN_IN_HIGH = 0.25;
const WIND_ABS = 20; // sustained mph that's notable anywhere
const WIND_ABS_HIGH = 30;
const GUST_ABS = 30;
const GUST_ABS_HIGH = 45;
const AQI_SENSITIVE = 101; // US AQI bands: unhealthy for sensitive groups / unhealthy
const AQI_UNHEALTHY = 151;
// … and the "outside YOUR normal" margins on top of the trailing window.
const WIND_OVER_TYPICAL = 8; // mph above the 30-day p95 before "windier than usual"
const WIND_UNUSUAL_FLOOR = 12; // but never alert under this — light wind is never news
const AQI_OVER_TYPICAL = 25; // AQI points above the 30-day p95
const AQI_UNUSUAL_FLOOR = 60;
const TEMP_ANOM_MIN = 8; // °F beyond the recent normal high/low before it's abnormal
const TEMP_ANOM_HIGH = 15; // this far beyond escalates to a warning
const MIN_READINGS = 50; // history depth before percentile baselines are trusted
const MIN_DAYS = 5; // completed days before temp normals are trusted

const fmtHour = (h) => {
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${h >= 12 ? "pm" : "am"}`;
};

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

// What this location normally does, from the trailing window of collected
// readings (all ok sources pooled): a p95/max for the spiky metrics (wind, AQI)
// and mean±sd of the completed local days' highs/lows. Today is excluded — it's
// the day being judged.
export function historyStats(locId, { offsetSec = 0, nowMs = Date.now(), windowDays = 30 } = {}) {
  const localDateOf = (ts) => new Date(Date.parse(ts) + offsetSec * 1000).toISOString().slice(0, 10);
  const todayLocal = new Date(nowMs + offsetSec * 1000).toISOString().slice(0, 10);
  const cutoff = new Date(nowMs - windowDays * 86400000 + offsetSec * 1000).toISOString().slice(0, 10);

  const winds = [], aqis = [];
  const tempsByDay = {}; // date -> source -> { hi, lo }
  for (const row of getReadings(locId)) {
    if (row.status !== "ok") continue;
    const date = localDateOf(row.ts);
    if (date < cutoff || date >= todayLocal) continue;
    if (row.wind_mph != null) winds.push(row.wind_mph);
    if (row.aqi != null) aqis.push(row.aqi);
    if (row.temp_f != null) {
      const cell = ((tempsByDay[date] ||= {})[row.source] ||= { hi: -Infinity, lo: Infinity });
      if (row.temp_f > cell.hi) cell.hi = row.temp_f;
      if (row.temp_f < cell.lo) cell.lo = row.temp_f;
    }
  }

  // One high/low per day = the cross-source mean of that day's per-source extremes.
  const highs = [], lows = [];
  for (const perSource of Object.values(tempsByDay)) {
    const hi = Object.values(perSource).map((c) => c.hi);
    const lo = Object.values(perSource).map((c) => c.lo);
    if (hi.length) highs.push(hi.reduce((a, b) => a + b, 0) / hi.length);
    if (lo.length) lows.push(lo.reduce((a, b) => a + b, 0) / lo.length);
  }

  const spiky = (vals) => {
    const sorted = [...vals].sort((a, b) => a - b);
    return { p95: percentile(sorted, 95), max: sorted[sorted.length - 1] ?? null, n: sorted.length };
  };
  const normal = (vals) => {
    if (!vals.length) return { mean: null, sd: null, n: 0 };
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
    return { mean, sd, n: vals.length };
  };

  return { wind: spiky(winds), aqi: spiky(aqis), high: normal(highs), low: normal(lows) };
}

// Today's hourly US-AQI forecast (Open-Meteo air-quality model) — the readings
// history only knows the past; this is the "bad air is COMING today" signal.
export async function fetchAqiForecastToday(location) {
  const url =
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${location.lat}&longitude=${location.lon}` +
    `&hourly=us_aqi&timezone=auto&forecast_days=1`;
  const data = await providerGetJSON("open_meteo", url);
  const times = data.hourly?.time || [];
  const vals = data.hourly?.us_aqi || [];
  const byHour = Array(24).fill(null);
  let max = null, maxHour = null;
  times.forEach((t, i) => {
    const h = Number(t.slice(11, 13));
    const v = vals[i];
    if (Number.isNaN(h) || v == null) return;
    byHour[h] = Math.round(v);
    if (max == null || v > max) { max = Math.round(v); maxHour = h; }
  });
  return { byHour, max, maxHour };
}

// Official NWS watches/warnings/advisories in effect at the point (US only —
// elsewhere the endpoint errors and the caller treats it as none). Deduped by
// event name, capped so a stormy day doesn't shove the dashboard down the page.
export async function fetchNwsAdvisories(location) {
  const data = await getJSON(`https://api.weather.gov/alerts/active?point=${location.lat},${location.lon}`);
  const seen = new Set();
  const out = [];
  for (const f of data.features || []) {
    const p = f.properties || {};
    if (p.status !== "Actual") continue;
    if (!p.event || seen.has(p.event)) continue;
    seen.add(p.event);
    out.push({
      kind: "advisory",
      severity: p.severity === "Severe" || p.severity === "Extreme" ? "warning" : "notice",
      icon: "📢",
      headline: p.event,
      detail: p.headline ? `${String(p.headline).slice(0, 200)} (NWS)` : "Issued by the National Weather Service.",
    });
    if (out.length >= 3) break;
  }
  return out;
}

// The anomaly rules. Pure — everything network/disk is passed in — so the
// thresholds above are directly testable.
//   consensus: forecastConsensus() for today      forecasts: per-source daily
//   hours:     hourlyForDate().hours              aqiToday: fetchAqiForecastToday()
//   stats:     historyStats()
/** @param {{ consensus: any, forecasts?: any, hours?: any[], aqiToday?: any, stats?: any }} args */
export { buildAlerts } from "./alerts-core.mjs";
