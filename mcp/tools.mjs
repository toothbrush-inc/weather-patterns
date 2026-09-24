// MCP tool handlers. Deterministic JSON over the existing lib layer — same
// settings.json / history.json / forecasts.json the dashboard and collector use.
// Pattern mirrors calsync: ToolResult<T>, never prose, never raw credentials.

import { profileContext } from "@dvd-toy-box/vault/kit";

import { getConfig, resolveLocation, isValidLocation } from "../lib/config.mjs";
import { haversineMiles } from "../lib/geo.mjs";
import {
  addLocation,
  updateLocation,
  removeLocation,
  setActiveLocation,
} from "../lib/settings.mjs";
import { getKeyStatusViews, hasProviderSecret } from "../lib/vault.mjs";
import { isVaultProvider, startConnect } from "./connect.mjs";
import { getHistory, countReadings } from "../lib/db.mjs";
import { buildPayload } from "../lib/payload.mjs";
import { enabledSourcesFor, findNearbyPurpleAir } from "../lib/sources.mjs";
import {
  collectForecasts,
  forecastsForDate,
  forecastConsensus,
} from "../lib/forecast.mjs";
import {
  buildAccuracy,
  diurnalProjection,
  sensorRelativeOffsets,
  yesterdayAtThisHour,
} from "../lib/accuracy.mjs";
import { runCollection } from "../lib/collect.mjs";
import { searchPlaces } from "../lib/geocode.mjs";
import { recordCapabilityGap } from "../lib/gaps.mjs";
import { METRICS, SOURCE_LABELS, SPREAD_THRESHOLDS } from "../lib/constants.mjs";
import { toJsonPayload } from "./privacy.mjs";

export { toJsonPayload };

const READING_FIELDS = [
  "ts", "source", "status", "error", "temp_f", "humidity", "wind_mph",
  "pressure_inhg", "pm25", "aqi", "conditions", "place", "distance_mi", "source_url",
];

export async function handleGetStatus() {
  try {
    const cfg = getConfig();
    const locations = await Promise.all(cfg.locations.map(async (loc) => {
      const history = getHistory(loc.id, 1);
      const last = history.length ? history[history.length - 1] : null;
      return {
        ...publicLocation(loc),
        sources_enabled: await enabledSourcesFor(loc),
        last_snapshot_at: last?.ts ?? null,
        reading_count: countReadings(loc.id),
      };
    }));
    const prefs = await callerPreferences();
    const mine = await defaultLocationFor(cfg);
    return ok({
      locations,
      activeLocationId: cfg.activeLocationId,
      // The caller's own view: which location tools default to for them.
      caller: {
        default_location_id: mine?.id ?? null,
        profile_source: prefs.source,
        ...(prefs.note === undefined ? {} : { profile_note: prefs.note }),
      },
      key_status: await getKeyStatusViews(),
      collector: {
        scheduled: true,
        note: "History accumulates via the in-process scheduler or `npm run collect`. Call collect_now to take one snapshot now.",
      },
      sourceLabels: SOURCE_LABELS,
    });
  } catch (error) {
    return fail(error, "status_failed");
  }
}

export async function handleSearchPlaces(input = {}) {
  try {
    const query = String(input.query || "").trim();
    if (query.length < 2) {
      return fail(new Error("query must be at least 2 characters"), "invalid_query");
    }
    return ok(await searchPlaces(query, { limit: input.limit ?? 6 }));
  } catch (error) {
    return fail(error, "geocode_failed");
  }
}

export async function handleAddLocation(input = {}) {
  try {
    const resolved = await resolveNewLocation(input);
    if (!resolved.ok) return resolved;
    if (resolved.data.candidates) return ok(resolved.data);

    const loc = addLocation(resolved.data.location);
    // The active location is shared by everyone on the instance (and is the
    // dashboard's anonymous default), so moving it is opt-in, not a side effect.
    if (input.select === true) {
      try { setActiveLocation(loc.id); } catch { /* ignore */ }
    }
    return ok({ added: true, location: publicLocation(loc) });
  } catch (error) {
    return fail(error, "add_location_failed");
  }
}

export function handleUpdateLocation(input = {}) {
  try {
    if (!input.id) return fail(new Error("id is required"), "invalid_location");
    const loc = updateLocation(input.id, {
      ...(input.name != null ? { name: input.name } : {}),
      ...(input.lat != null ? { lat: input.lat } : {}),
      ...(input.lon != null ? { lon: input.lon } : {}),
      ...("purpleair_sensor_index" in input ? { purpleair_sensor_index: input.purpleair_sensor_index } : {}),
    });
    if (!loc) return fail(new Error(`unknown location id: ${input.id}`), "unknown_location");
    if (input.select === true) setActiveLocation(loc.id);
    return ok({ location: publicLocation(loc) });
  } catch (error) {
    return fail(error, "update_location_failed");
  }
}

export function handleRemoveLocation(input = {}) {
  try {
    if (!input.id) return fail(new Error("id is required"), "invalid_location");
    const locations = removeLocation(input.id).filter(isValidLocation).map(publicLocation);
    return ok({ removed: input.id, locations });
  } catch (error) {
    return fail(error, "remove_location_failed");
  }
}

export async function handleConnectProvider(input = {}) {
  const provider = input.provider;
  if (!isVaultProvider(provider)) {
    return fail(
      new Error("unknown provider: use purpleair or open_meteo. Never pass an API key to this tool."),
      "unknown_provider",
    );
  }
  try {
    const started = await startConnect(provider, {
      openBrowser: input.open_browser !== false,
      onBrowserOpenFailure: (url, error) => {
        const detail = error instanceof Error ? `: ${error.message}` : "";
        process.stderr.write(
          `weather-patterns mcp: could not open the system browser${detail}\nOpen this URL manually:\n${url}\n`,
        );
      },
    });
    return ok({
      provider: started.provider,
      slot: started.slot,
      url: started.url,
      expires_at: started.expiresAt,
      note: "Open the URL, paste the key in the browser form, then call get_status. Never pass the key to this tool.",
    });
  } catch (error) {
    return fail(error, "connect_provider_failed");
  }
}

export async function handleFindPurpleairSensors(input = {}) {
  try {
    const cfg = getConfig();
    if (!(await hasProviderSecret("purpleair"))) {
      return fail(
        new Error("no PurpleAir key set — call connect_provider with provider=purpleair (opens a local browser form)"),
        "missing_key",
      );
    }
    const point = input.location_id || input.location_name
      ? await pickLocation(cfg, input)
      : { lat: input.lat, lon: input.lon };
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) {
      return fail(new Error("need location_id, location_name, or lat+lon"), "invalid_location");
    }
    const sensors = await findNearbyPurpleAir(point, {
      radiusMi: input.radius_mi ?? 10,
      limit: input.limit ?? 5,
    });
    return ok({
      location: point.id ? publicLocation(point) : { lat: point.lat, lon: point.lon },
      sensors,
    });
  } catch (error) {
    return fail(error, "purpleair_search_failed");
  }
}

export async function handleGetCurrent(input = {}) {
  try {
    const cfg = getConfig();
    const location = await pickLocation(cfg, input);
    const payload = await buildPayload(location.id);
    const latest = trimLatest(payload.latest);
    const ts = Object.values(latest).map((r) => r.ts).filter(Boolean).sort().reverse()[0] || null;

    // The website's "warmer/cooler than yesterday right now" card: yesterday's
    // reading nearest this local hour (sensor preferred) vs the same source now.
    const yesterday = yesterdayAtThisHour(location);
    let vsYesterday;
    if (yesterday) {
      const nowReading =
        latest[yesterday.source]?.temp_f ??
        Object.values(latest).map((r) => r.temp_f).find((t) => t != null) ??
        null;
      vsYesterday = {
        ...yesterday,
        ...(nowReading == null ? {} : { now_f: nowReading, delta_f: Math.round(nowReading - yesterday.temp_f) }),
      };
    }

    return ok({
      location: publicLocation(location),
      generated: payload.generated,
      last_snapshot_at: ts,
      age_seconds: ts ? Math.max(0, Math.round((Date.now() - Date.parse(ts)) / 1000)) : null,
      totalReadings: payload.totalReadings,
      sourceStatus: payload.sourceStatus,
      latest,
      ...(vsYesterday ? { vs_yesterday: vsYesterday } : {}),
      note: payload.totalReadings === 0
        ? "No collected history yet. Call collect_now, or wait for the scheduler."
        : undefined,
    });
  } catch (error) {
    return fail(error, "current_failed");
  }
}

export async function handleGetForecast(input = {}) {
  try {
    const cfg = getConfig();
    const location = await pickLocation(cfg, input);
    const { results, today, tomorrow } = await collectForecasts(location);
    const days = Math.min(7, Math.max(1, Number(input.days) || 1));
    const start = input.date || today;
    const dates = availableDates(results, start, days);
    const byDate = dates.map((date) => {
      const forecasts = forecastsForDate(results, date);
      return { date, forecasts, consensus: forecastConsensus(forecasts) };
    });

    // Sensor-relative view: each source's forecast re-expressed against the
    // local PurpleAir sensor via a rolling median offset (from the same
    // ledgers the accuracy page scores). Raw numbers stay primary.
    const rel = sensorRelativeOffsets(location, {
      offsetSec: results.open_meteo?.utc_offset_seconds ?? 0,
    });
    const hasOffsets = Object.keys(rel.per_source).length > 0;
    if (hasOffsets) {
      const basis = `median (forecast − purpleair observed), last ${rel.window_days} days`;
      const avg = (vals) =>
        vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
      for (const day of byDate) {
        const adjustedHighs = [];
        const adjustedLows = [];
        for (const [source, fc] of Object.entries(day.forecasts)) {
          const o = rel.per_source[source];
          if (!o || fc.status !== "ok") continue;
          const high_f =
            fc.high_f != null && o.high.offset != null ? Math.round(fc.high_f + o.high.offset) : null;
          const low_f =
            fc.low_f != null && o.low.offset != null ? Math.round(fc.low_f + o.low.offset) : null;
          fc.sensor_relative = {
            high_f,
            low_f,
            offset: { high: o.high.offset, low: o.low.offset },
            n: { high: o.high.n, low: o.low.n },
            basis,
          };
          if (high_f != null) adjustedHighs.push(high_f);
          if (low_f != null) adjustedLows.push(low_f);
        }
        if (day.consensus && (adjustedHighs.length || adjustedLows.length)) {
          day.consensus.sensor_relative = { high_f: avg(adjustedHighs), low_f: avg(adjustedLows) };
        }
      }
    }

    // The website's "on track for X°" hero number, when today is in range:
    // project today's high from the current temp and the ledger's typical
    // daily temperature shape.
    let todayProjection;
    if (dates.includes(today)) {
      const diurnal = diurnalProjection(location, {
        offsetSec: results.open_meteo?.utc_offset_seconds ?? 0,
      });
      if (diurnal && (diurnal.estHigh != null || diurnal.todayMaxSoFar != null)) {
        todayProjection = {
          est_high_f: diurnal.estHigh,
          current_f: diurnal.tNow,
          max_so_far_f: diurnal.todayMaxSoFar,
          pct_to_peak: diurnal.pctToPeak,
          basis: `${diurnal.profileDays}-day diurnal shape from ${diurnal.source}`,
        };
      }
    }

    return ok({
      location: publicLocation(location),
      today,
      tomorrow,
      ...(hasOffsets
        ? { sensor_relative_reference: { reference: rel.reference, window_days: rel.window_days } }
        : {}),
      ...(todayProjection ? { today_projection: todayProjection } : {}),
      days: byDate,
    });
  } catch (error) {
    return fail(error, "forecast_failed");
  }
}

export async function handleQueryHistory(input = {}) {
  try {
    const cfg = getConfig();
    const location = await pickLocation(cfg, input);
    const hours = Math.min(24 * 30, Math.max(1, Number(input.hours) || 48));
    const limit = Math.min(500, Math.max(1, Number(input.limit) || 48));
    const cutoff = Date.now() - hours * 3600 * 1000;
    const history = getHistory(location.id, 500).filter((r) => Date.parse(r.ts) >= cutoff);
    const timestamps = [...new Set(history.map((r) => r.ts))].sort();
    const keep = new Set(timestamps.slice(-limit));
    const points = history.filter((r) => keep.has(r.ts)).map(trimReading);
    return ok({
      location: publicLocation(location),
      hours,
      snapshots: timestamps.length,
      returned_snapshots: keep.size,
      points,
    });
  } catch (error) {
    return fail(error, "history_failed");
  }
}

export async function handleCompareSources(input = {}) {
  try {
    const cfg = getConfig();
    const location = await pickLocation(cfg, input);
    const payload = await buildPayload(location.id);
    const latest = trimLatest(payload.latest);
    return ok({
      location: publicLocation(location),
      generated: payload.generated,
      sourceStatus: payload.sourceStatus,
      latest,
      spreads: metricSpreads(latest),
      outliers: payload.outliers,
      comparisons: payload.comparisons,
    });
  } catch (error) {
    return fail(error, "compare_failed");
  }
}

export async function handleForecastAccuracy(input = {}) {
  try {
    const cfg = getConfig();
    const location = await pickLocation(cfg, input);
    const windowDays = Math.min(90, Math.max(7, Number(input.window_days) || 30));
    const acc = await buildAccuracy(location, { windowDays });
    const diurnal = acc.diurnal
      ? {
          estHigh: acc.diurnal.estHigh,
          tNow: acc.diurnal.tNow,
          todayMaxSoFar: acc.diurnal.todayMaxSoFar,
          peakHour: acc.diurnal.peakHour,
          troughHour: acc.diurnal.troughHour,
          pctToPeak: acc.diurnal.pctToPeak,
        }
      : null;
    return ok({
      location: publicLocation(location),
      windowDays: acc.windowDays,
      todayLocal: acc.todayLocal,
      scoredDays: acc.scoredDays,
      hasPurpleair: acc.hasPurpleair,
      perSource: acc.perSource,
      provisional: acc.provisional,
      yesterday: acc.yesterday,
      diurnal,
      daily: (acc.daily || []).slice(-7),
    });
  } catch (error) {
    return fail(error, "accuracy_failed");
  }
}

export async function handleCollectNow(input = {}) {
  try {
    const cfg = getConfig();
    const only = input.location_id || undefined;
    if (only && !cfg.locations.some((l) => l.id === only)) {
      return fail(new Error(`unknown location id: ${only}`), "unknown_location");
    }
    const runs = await runCollection({ only, cfg });
    return ok({
      collected: runs.map((r) => ({
        id: r.id,
        name: r.name,
        ts: r.ts,
        stored: r.stored,
        forecastsLogged: r.forecastsLogged,
        enabled: r.enabled,
        sources: Object.fromEntries(
          Object.entries(r.results).map(([source, d]) => [
            source,
            {
              status: d.status,
              error: d.error ?? null,
              temp_f: d.temp_f ?? null,
              conditions: d.conditions ?? null,
              aqi: d.aqi ?? null,
            },
          ]),
        ),
      })),
    });
  } catch (error) {
    return fail(error, "collect_failed");
  }
}

export function handleRequestCapability(input = {}) {
  try {
    const row = recordCapabilityGap({ intent: input.intent, context: input.context });
    return ok({ recorded: true, ...row });
  } catch (error) {
    return fail(error, "gap_failed");
  }
}

// ---- helpers --------------------------------------------------------------

function publicLocation(loc) {
  return {
    id: loc.id,
    name: loc.name,
    lat: loc.lat,
    lon: loc.lon,
    purpleair_sensor_index: loc.purpleair_sensor_index || "",
  };
}

/** Profile fields this capability declares (capability.json). */
const PROFILE_FIELDS = ["home_lat", "home_lon"];

/**
 * Where the calling user lives, if they've said. Read per call, never cached in
 * module scope: one process serves every user, so a cached value would outlive
 * its caller and be served to the next one (CAPABILITY.md §9). Never throws —
 * an ungranted or unset field just yields nothing.
 *
 * Units are deliberately not read: readings are labelled (temp_f, wind_mph), so
 * the unit travels with the value and needs no per-user preference.
 */
async function callerPreferences() {
  return await profileContext("weather", PROFILE_FIELDS);
}

/**
 * Which location is "theirs" when a tool is called with no location argument:
 * the tracked location nearest their profile home, else the shared active one.
 * The tracked list and the collected readings stay shared — only the choice
 * among them is personal, so extra users cost no extra collection.
 */
async function defaultLocationFor(cfg) {
  const { values } = await callerPreferences();
  const home = { lat: Number(values.home_lat), lon: Number(values.home_lon) };
  if (Number.isFinite(home.lat) && Number.isFinite(home.lon)) {
    let best = null;
    let bestMi = Infinity;
    for (const loc of cfg.locations) {
      const mi = haversineMiles(home, loc);
      if (mi != null && mi < bestMi) {
        bestMi = mi;
        best = loc;
      }
    }
    if (best) return best;
  }
  return resolveLocation(cfg);
}

async function pickLocation(cfg, input = {}) {
  if (input.location_id) {
    const loc = cfg.locations.find((l) => l.id === input.location_id);
    if (!loc) throw Object.assign(new Error(`unknown location id: ${input.location_id}`), { code: "unknown_location" });
    return loc;
  }
  if (input.location_name) {
    const q = String(input.location_name).toLowerCase();
    const matches = cfg.locations.filter((l) => (l.name || "").toLowerCase().includes(q));
    if (matches.length === 1) return matches[0];
    if (matches.length === 0) {
      throw Object.assign(new Error(`no location matching "${input.location_name}"`), { code: "unknown_location" });
    }
    throw Object.assign(
      new Error(`ambiguous location_name "${input.location_name}": ${matches.map((l) => l.id).join(", ")}`),
      { code: "ambiguous_location" },
    );
  }
  return await defaultLocationFor(cfg);
}

async function resolveNewLocation(input) {
  let name = input.name;
  let lat = input.lat;
  let lon = input.lon;
  let purpleair_sensor_index = input.purpleair_sensor_index;

  if ((lat == null || lon == null) && input.query) {
    const { results, attribution } = await searchPlaces(input.query);
    if (!results.length) {
      return fail(new Error(`no places found for "${input.query}"`), "place_not_found");
    }
    if (results.length > 1 && (lat == null || lon == null)) {
      return ok({
        added: false,
        reason: "multiple_matches",
        attribution,
        candidates: results,
        note: "Pick one candidate and call add_location with its name/lat/lon.",
      });
    }
    name = name || results[0].name;
    lat = results[0].lat;
    lon = results[0].lon;
  }

  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) {
    return fail(new Error("need query, or numeric lat and lon"), "invalid_location");
  }

  if (input.nearest_purpleair && !purpleair_sensor_index) {
    if (!(await hasProviderSecret("purpleair"))) {
      return fail(
        new Error("nearest_purpleair requires a PurpleAir key — call connect_provider with provider=purpleair first"),
        "missing_key",
      );
    }
    const nearest = (await findNearbyPurpleAir({ lat, lon }, { limit: 1 }))[0];
    if (nearest) purpleair_sensor_index = nearest.sensor_index;
  }

  return ok({
    location: { name, lat, lon, purpleair_sensor_index },
  });
}

function trimReading(row) {
  const out = {};
  for (const k of READING_FIELDS) {
    if (row[k] !== undefined) out[k] = row[k];
  }
  return out;
}

function trimLatest(latest) {
  return Object.fromEntries(Object.entries(latest || {}).map(([k, v]) => [k, trimReading(v)]));
}

function metricSpreads(latest) {
  const out = {};
  for (const m of METRICS) {
    const vals = Object.entries(latest)
      .filter(([, r]) => r.status === "ok" && r[m] != null)
      .map(([source, r]) => ({ source, value: r[m] }));
    if (!vals.length) continue;
    const numbers = vals.map((v) => v.value);
    const min = Math.min(...numbers);
    const max = Math.max(...numbers);
    const spread = vals.length >= 2 ? Math.round((max - min) * 100) / 100 : 0;
    const [green, amber] = SPREAD_THRESHOLDS[m] || [Infinity, Infinity];
    const flag = spread <= green ? "green" : spread <= amber ? "amber" : "red";
    out[m] = { min, max, spread, flag, values: Object.fromEntries(vals.map((v) => [v.source, v.value])) };
  }
  return out;
}

function availableDates(results, start, days) {
  const all = [...new Set(
    Object.values(results).flatMap((r) => (r.byDate ? Object.keys(r.byDate) : [])),
  )].sort();
  if (!start) return all.slice(0, days);
  const from = all.filter((d) => d >= start);
  return (from.length ? from : all).slice(0, days);
}

function ok(data) {
  return { ok: true, data };
}

function fail(error, code) {
  const message = error instanceof Error && error.message.trim() ? error.message : "Unknown error";
  return { ok: false, error: { code: error?.code || code, message } };
}
