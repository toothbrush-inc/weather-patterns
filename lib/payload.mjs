// Builds the dashboard payload for one location from stored history: latest
// reading per source, and an "outlier leaderboard" (how often each source is
// furthest from the group median, per metric, per snapshot).

import { getHistory, countReadings } from "./db.mjs";
import { getConfig, resolveLocation } from "./config.mjs";
import { enabledSourcesFor } from "./sources.mjs";
import { getProviderSecret } from "./vault.mjs";
import { haversineMiles, roundMiles } from "./geo.mjs";
import { METRICS, METRIC_LABELS, SOURCE_LABELS, SOURCE_COLORS } from "./constants.mjs";

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Show every always-on source plus any that *could* run here, so the table
// header stays stable and the status pills can explain what's missing.
const SOURCES = ["nws", "open_meteo", "purpleair"];

// Build the payload for the given location id (falls back to the active one).
// `scope` (lib/scope.mjs) narrows the view to the caller's own locations; without
// it the shared pool is used, as the MCP tools and single-tenant instances do.
/** @param {string} [locId] @param {{ cfg?: any, caller?: { id: string } | null } | null} [scope] */
export async function buildPayload(locId, scope = null) {
  const cfg = scope?.cfg ?? getConfig();
  const caller = scope?.caller ? { id: scope.caller.id } : null;
  const location = resolveLocation(cfg, locId);
  if (!location) return emptyPayload(cfg, caller);
  const enabled = await enabledSourcesFor(location);
  const sources = SOURCES;
  const history = getHistory(location.id);

  // latest ok reading per source, annotated with how far that reading's true
  // location is from this location's coordinates (so cross-area gaps are visible).
  const latest = {};
  for (const row of history) {
    if (row.status === "ok") latest[row.source] = row;
  }
  // Drop a source's last reading once it's no longer enabled for this location
  // (e.g. its PurpleAir sensor was removed) — otherwise the current-readings table
  // keeps showing it and the removal looks like it didn't take. History/charts keep
  // the past readings; this only affects the "current" view.
  for (const s of Object.keys(latest)) {
    if (!enabled.includes(s)) delete latest[s];
  }
  for (const s of Object.keys(latest)) {
    const d = haversineMiles(location, latest[s]);
    latest[s] = { ...latest[s], distance_mi: roundMiles(d) };
  }

  // group by timestamp for outlier analysis
  const byTs = {};
  for (const row of history) {
    if (row.status === "ok") (byTs[row.ts] ||= []).push(row);
  }

  const outliers = Object.fromEntries(sources.map((s) => [s, 0]));
  let comparisons = 0;
  for (const group of Object.values(byTs)) {
    for (const m of METRICS) {
      const vals = group
        .filter((g) => g[m] !== null && g[m] !== undefined)
        .map((g) => ({ source: g.source, v: g[m] }));
      if (vals.length >= 3) {
        const med = median(vals.map((x) => x.v));
        let worst = vals[0];
        for (const x of vals) if (Math.abs(x.v - med) > Math.abs(worst.v - med)) worst = x;
        if (Math.abs(worst.v - med) > 0) outliers[worst.source] = (outliers[worst.source] || 0) + 1;
        comparisons += 1;
      }
    }
  }

  return {
    location,
    locations: cfg.locations,
    activeLocationId: cfg.activeLocationId,
    caller,
    keys: {
      purpleair: !!(await getProviderSecret("purpleair")),
    },
    generated: new Date().toISOString(),
    totalReadings: countReadings(location.id),
    sources,
    sourceLabels: SOURCE_LABELS,
    sourceColors: SOURCE_COLORS,
    metricLabels: METRIC_LABELS,
    metrics: METRICS,
    latest,
    history,
    outliers,
    comparisons,
    sourceStatus: Object.fromEntries(sources.map((k) => [k, enabled.includes(k)])),
  };
}

// A signed-in caller who follows nothing yet: same shape, nothing to show. The
// dashboard reads `location: null` as "run the setup card".
async function emptyPayload(cfg, caller) {
  return {
    location: null,
    locations: [],
    activeLocationId: "",
    caller,
    keys: { purpleair: !!(await getProviderSecret("purpleair")) },
    generated: new Date().toISOString(),
    totalReadings: 0,
    sources: SOURCES,
    sourceLabels: SOURCE_LABELS,
    sourceColors: SOURCE_COLORS,
    metricLabels: METRIC_LABELS,
    metrics: METRICS,
    latest: {},
    history: [],
    outliers: Object.fromEntries(SOURCES.map((s) => [s, 0])),
    comparisons: 0,
    sourceStatus: Object.fromEntries(SOURCES.map((s) => [s, false])),
  };
}
