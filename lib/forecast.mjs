// Daily forecast per source. Each forecaster returns a per-date map
// { byDate: { "YYYY-MM-DD": { high_f, low_f, conditions, precip_prob, precip_in } },
//   source_url } so callers can read today's forecast (the live comparison) or
// tomorrow's (the 1-day-ahead snapshot we log for accuracy scoring). Only sources
// that publish a forecast appear — NWS and Open-Meteo. PurpleAir is a live sensor
// with no forecast. Registry-based (FORECASTERS) so more fields/sources slot in
// the same way.

import { WMO } from "./constants.mjs";
import { getJSON } from "./http.mjs";
import { providerGetJSON } from "./provider-http.mjs";

const roundF = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x));
const r1 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10) / 10);
const mmToIn = (mm) => (mm == null || Number.isNaN(mm) ? null : Math.round((mm / 25.4) * 100) / 100);

// NWS wind speeds are strings ("12 mph", "5 to 10 mph") — take the top of the range.
const parseWindMph = (s) => {
  const m = String(s ?? "").match(/\d+(\.\d+)?/g);
  return m?.length ? Math.max(...m.map(Number)) : null;
};

function emptyDay() {
  return { high_f: null, low_f: null, conditions: null, precip_prob: null, precip_in: null };
}

// ---------------------------------------------------------------- NWS -------
// points → forecast periods. Group periods by their local date; the daytime
// period is that date's high, the nighttime period its low. Daytime also carries
// the human conditions string and precip probability the MCP "today" query needs.
async function forecastNWS(location) {
  const { lat, lon } = location;
  const points = await getJSON(`https://api.weather.gov/points/${lat},${lon}`);
  const [fc, hourlyFc] = await Promise.all([
    getJSON(points.properties.forecast),
    // Hour-by-hour feeds the today chart and heads-up alerts; the daily high/low
    // must not fail because the hourly endpoint hiccupped, so it's best-effort.
    getJSON(points.properties.forecastHourly).catch(() => null),
  ]);
  const periods = fc.properties?.periods || [];
  if (!periods.length) throw new Error(`no NWS forecast near ${location.name}`);
  const byDate = {};
  for (const p of periods) {
    const d = p.startTime?.slice(0, 10); // local date (startTime carries the offset)
    if (!d) continue;
    byDate[d] ||= emptyDay();
    const precip = p.probabilityOfPrecipitation?.value;
    if (p.isDaytime) {
      byDate[d].high_f = roundF(p.temperature);
      byDate[d].conditions = p.shortForecast || byDate[d].conditions;
      if (precip != null) byDate[d].precip_prob = precip;
    } else {
      byDate[d].low_f = roundF(p.temperature);
      if (!byDate[d].conditions) byDate[d].conditions = p.shortForecast || null;
      if (byDate[d].precip_prob == null && precip != null) byDate[d].precip_prob = precip;
    }
  }
  // byHour[date][hour] — NWS hourly periods are one hour each; startTime carries
  // the local offset, so slicing gives the local date and hour directly.
  const byHour = {};
  for (const p of hourlyFc?.properties?.periods || []) {
    const d = p.startTime?.slice(0, 10);
    const h = p.startTime ? Number(p.startTime.slice(11, 13)) : NaN;
    if (!d || Number.isNaN(h)) continue;
    (byHour[d] ||= {})[h] = {
      temp_f: roundF(p.temperature),
      precip_prob: p.probabilityOfPrecipitation?.value ?? null,
      precip_in: null,
      wind_mph: parseWindMph(p.windSpeed),
      gust_mph: null,
      conditions: p.shortForecast || null,
      is_day: p.isDaytime ?? null,
    };
  }
  return {
    byDate,
    byHour,
    source_url: `https://forecast.weather.gov/MapClick.php?lat=${lat}&lon=${lon}`,
  };
}

// ---------------------------------------------------------- Open-Meteo ------
async function forecastOpenMeteo(location) {
  const { lat, lon } = location;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,precipitation_sum` +
    `&hourly=temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,weather_code,is_day` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=7`;
  const data = await providerGetJSON("open_meteo", url);
  const d = data.daily || {};
  const byDate = {};
  (d.time || []).forEach((date, i) => {
    byDate[date] = {
      high_f: roundF(d.temperature_2m_max?.[i]),
      low_f: roundF(d.temperature_2m_min?.[i]),
      conditions: WMO[d.weather_code?.[i]] ?? (d.weather_code?.[i] != null ? `code ${d.weather_code[i]}` : null),
      precip_prob: d.precipitation_probability_max?.[i] ?? null,
      precip_in: mmToIn(d.precipitation_sum?.[i]),
    };
  });
  // byHour[date][hour] — hourly times are local ISO strings (timezone=auto).
  const h = data.hourly || {};
  const byHour = {};
  (h.time || []).forEach((t, i) => {
    const date = t.slice(0, 10);
    const hh = Number(t.slice(11, 13));
    if (Number.isNaN(hh)) return;
    (byHour[date] ||= {})[hh] = {
      temp_f: r1(h.temperature_2m?.[i]),
      precip_prob: h.precipitation_probability?.[i] ?? null,
      precip_in: mmToIn(h.precipitation?.[i]),
      wind_mph: r1(h.wind_speed_10m?.[i]),
      gust_mph: r1(h.wind_gusts_10m?.[i]),
      conditions: WMO[h.weather_code?.[i]] ?? null,
      is_day: h.is_day?.[i] == null ? null : Boolean(h.is_day[i]),
    };
  });
  return { byDate, byHour, source_url: url, utc_offset_seconds: data.utc_offset_seconds };
}

export const FORECASTERS = {
  nws: forecastNWS,
  open_meteo: forecastOpenMeteo,
};

// Sources that publish a daily forecast for a location. Both need only lat/lon.
export function forecastSourcesFor() {
  return ["nws", "open_meteo"];
}

// Fetch every forecast source's per-date map for a location, and anchor the local
// "today"/"tomorrow" dates. These are computed deterministically from the
// location's UTC offset (Open-Meteo returns it) — NOT from the first entry of a
// returned date array, which can lag by a day right after local midnight and cause
// a same-day forecast to be logged as if it were 1-day-ahead.
export async function collectForecasts(location) {
  const keys = forecastSourcesFor();
  const settled = await Promise.allSettled(keys.map((k) => FORECASTERS[k](location)));
  const results = {};
  keys.forEach((key, i) => {
    const s = settled[i];
    results[key] =
      s.status === "fulfilled"
        ? { ...s.value, status: "ok" }
        : { status: "error", error: String(s.reason?.message || s.reason) };
  });

  const offset = results.open_meteo?.utc_offset_seconds;
  let today = null, tomorrow = null;
  if (typeof offset === "number") {
    const localDay = (ms) => new Date(ms + offset * 1000).toISOString().slice(0, 10);
    today = localDay(Date.now());
    tomorrow = localDay(Date.now() + 86400000);
  } else {
    const dates = Array.from(
      new Set(Object.values(results).flatMap((r) => (r.byDate ? Object.keys(r.byDate) : []))),
    ).sort();
    today = dates[0] || null;
    tomorrow = dates[1] || null;
  }
  return { results, today, tomorrow };
}

export { forecastsForDate, hourlyForDate, forecastConsensus } from "./forecast-core.mjs";
