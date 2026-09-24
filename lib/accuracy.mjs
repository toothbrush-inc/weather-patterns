import { scoreAccuracy, buildDiurnal } from "./accuracy-core.mjs";
export { scoreAccuracy } from "./accuracy-core.mjs";
// Forecast-accuracy scoring. For each completed day where we logged a 1-day-ahead
// forecast, compare it to what actually happened:
//   - vs the source's OWN observed daily high/low (NWS from our snapshots,
//     Open-Meteo from its archive/reanalysis API), and
//   - vs the PurpleAir sensor's observed high/low (an independent local truth).
// The gap between own-obs and PurpleAir-obs is the station-representativeness
// error, which lets you separate "the model forecast badly" from "the station is
// somewhere else." Aggregated as MAE (typical miss) and bias (systematic warm/cool)
// for high and low, per source, over a trailing window.

import { getForecasts } from "./forecastdb.mjs";
import { getReadings } from "./db.mjs";
import { providerGetJSON } from "./provider-http.mjs";

const DAY_MS = 86400000;
const utcDate = (ms) => new Date(ms).toISOString().slice(0, 10);
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const rWhole = (x) => (x == null ? null : Math.round(x));

const SOURCES = ["nws", "open_meteo"]; // forecast-capable sources

export async function buildAccuracy(location, { windowDays = 30 } = {}) {
  const locId = location.id;
  const forecasts = getForecasts(locId);

  // Open-Meteo archive over a trailing window → Open-Meteo "own" actuals, plus the
  // location's UTC offset (used to bucket our own snapshots into local days).
  const nowMs = Date.now();
  let offsetSec = 0;
  const omActual = {}; // date -> { high_f, low_f }
  try {
    const archiveUrl =
      `https://archive-api.open-meteo.com/v1/archive?latitude=${location.lat}&longitude=${location.lon}` +
      `&start_date=${utcDate(nowMs - (windowDays + 2) * DAY_MS)}&end_date=${utcDate(nowMs - DAY_MS)}` +
      `&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=auto`;
    const arc = await providerGetJSON("open_meteo", archiveUrl);
    offsetSec = arc.utc_offset_seconds || 0;
    const d = arc.daily || {};
    (d.time || []).forEach((date, i) => {
      omActual[date] = { high_f: rWhole(d.temperature_2m_max?.[i]), low_f: rWhole(d.temperature_2m_min?.[i]) };
    });
  } catch {
    /* archive down: Open-Meteo own-obs scoring is skipped; NWS/PurpleAir still work */
  }

  return scoreAccuracy(location, { readings: getReadings(locId), forecasts, omActual, nowMs, offsetSec, windowDays });
}

// Pure scoring core shared by live collection and deterministic scenario fixtures.
function ledgerSamples(locId, offsetSec) {
  const localDateOf = (ts) => new Date(Date.parse(ts) + offsetSec * 1000).toISOString().slice(0, 10);
  const localHourOf = (ts) => {
    const d = new Date(Date.parse(ts) + offsetSec * 1000);
    return d.getUTCHours() + d.getUTCMinutes() / 60;
  };
  const samples = [];
  let hasPurpleair = false;
  for (const row of getReadings(locId)) {
    if (row.status !== "ok" || row.temp_f == null) continue;
    if (row.source === "purpleair") hasPurpleair = true;
    samples.push({ source: row.source, date: localDateOf(row.ts), hour: localHourOf(row.ts), temp: row.temp_f });
  }
  return { samples, hasPurpleair };
}

// Ledger-only diurnal projection (the website's "on track for X°" number) for
// get_forecast — no archive call, safe on every request.
export function diurnalProjection(location, { windowDays = 30, offsetSec = 0, nowMs = Date.now() } = {}) {
  const todayLocal = new Date(nowMs + offsetSec * 1000).toISOString().slice(0, 10);
  const { samples, hasPurpleair } = ledgerSamples(location.id, offsetSec);
  return buildDiurnal(samples, { nowMs, offsetSec, todayLocal, hasPurpleair, windowDays });
}

// Ledger-only "yesterday at about this hour" observation (sensor preferred),
// for get_current's warmer/cooler-than-yesterday comparison.
export function yesterdayAtThisHour(location, { offsetSec = 0, nowMs = Date.now() } = {}) {
  const { samples, hasPurpleair } = ledgerSamples(location.id, offsetSec);
  const yLocal = new Date(nowMs + offsetSec * 1000 - DAY_MS).toISOString().slice(0, 10);
  const nowLocal = new Date(nowMs + offsetSec * 1000);
  const nowHourFrac = nowLocal.getUTCHours() + nowLocal.getUTCMinutes() / 60;
  let best = null;
  for (const s of samples) {
    if (s.date !== yLocal) continue;
    if (hasPurpleair && s.source !== "purpleair") continue;
    const diff = Math.abs(s.hour - nowHourFrac);
    if (diff <= 1.5 && (!best || diff < best.diff)) best = { diff, temp: s.temp, hour: s.hour };
  }
  return best
    ? {
        date: yLocal,
        temp_f: rWhole(best.temp),
        hour: r1(best.hour),
        source: hasPurpleair ? "purpleair" : "local observations",
      }
    : null;
}

// Sensor-relative offsets for get_forecast: per-source rolling median of
// (forecast − PurpleAir observed) over the trailing window, computed entirely
// from the local ledgers (no network). The offset is what to ADD to a raw
// forecast to express it relative to the sensor. No minimum-n gate — n is
// reported and the number simply firms up as days accumulate.
export function sensorRelativeOffsets(location, { windowDays = 7, offsetSec = 0, nowMs = Date.now() } = {}) {
  const localDateOf = (ts) => new Date(Date.parse(ts) + offsetSec * 1000).toISOString().slice(0, 10);
  const todayLocal = new Date(nowMs + offsetSec * 1000).toISOString().slice(0, 10);

  const pa = {}; // local date -> { hi, lo }
  for (const row of getReadings(location.id)) {
    if (row.source !== "purpleair" || row.status !== "ok" || row.temp_f == null) continue;
    const date = localDateOf(row.ts);
    const cell = (pa[date] ||= { hi: -Infinity, lo: Infinity });
    if (row.temp_f > cell.hi) cell.hi = row.temp_f;
    if (row.temp_f < cell.lo) cell.lo = row.temp_f;
  }

  const windowStart = utcDate(nowMs - windowDays * DAY_MS);
  const errs = {}; // source -> { high: [], low: [] }
  for (const f of getForecasts(location.id)) {
    if (f.target_date >= todayLocal || f.target_date < windowStart) continue;
    const targetNoonMs = Date.parse(`${f.target_date}T12:00:00Z`) - offsetSec * 1000;
    if (Date.parse(f.made_at) >= targetNoonMs) continue; // issued after the day's high
    const obs = pa[f.target_date];
    if (!obs) continue;
    const e = (errs[f.source] ||= { high: [], low: [] });
    if (f.high_f != null && obs.hi !== -Infinity) e.high.push(f.high_f - Math.round(obs.hi));
    if (f.low_f != null && obs.lo !== Infinity) e.low.push(f.low_f - Math.round(obs.lo));
  }

  const median = (arr) => {
    if (!arr.length) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const perSource = {};
  for (const [source, e] of Object.entries(errs)) {
    const high = median(e.high);
    const low = median(e.low);
    perSource[source] = {
      high: { offset: high == null ? null : r1(0 - high), n: e.high.length },
      low: { offset: low == null ? null : r1(0 - low), n: e.low.length },
    };
  }
  return { reference: "purpleair", window_days: windowDays, per_source: perSource };
}

// Build a normalized diurnal temperature shape from history (the local PurpleAir sensor
// if we have one, else all sources pooled) and use it to extrapolate today's still-to-come
// high. Each past day's readings are scaled to fraction-of-range [0..1] by local hour;
// averaging gives a daily shape with a peak (≈afternoon) and trough (≈pre-dawn). Given
// today's current temp and where it sits on that curve, solve for the day's full range and
// project the high. Deliberately basic and hedged — returns null (or estHigh:null) when
// data is thin or we're already past the peak.
