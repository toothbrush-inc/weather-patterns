// History store — append-only JSON file. Zero native dependencies, so it
// installs and runs identically on macOS, Linux, and CI with no build step.
//
// Each row carries the location it was collected for (loc_id + loc_name/lat/lon)
// so multiple locations accumulate independent divergence history in one file.
// Pre-existing rows (written before locations existed) have no loc_id and are
// attributed to the default location — see getHistory / DEFAULT_LOC_ID.
//
// For a serverless deploy (e.g. Vercel) the filesystem is ephemeral; swap the
// functions below for a hosted DB (Postgres / Turso / Upstash). Nothing else in
// the app needs to change — these signatures are the whole contract.

import fs from "node:fs";
import path from "node:path";
import { DEFAULT_LOC_ID } from "./constants.mjs";

function file() {
  return process.env.WEATHER_DB || path.join(process.cwd(), "history.json");
}

// Exported so the collector can park its lock file next to the history it guards.
export function historyFile() {
  return file();
}

function readAll() {
  try {
    const raw = fs.readFileSync(file(), "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}

function writeAll(rows) {
  const f = file();
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rows));
  fs.renameSync(tmp, f); // atomic replace, avoids partial-write corruption
}

// Does a stored row belong to this location? Untagged legacy rows fall under the
// default location so existing history isn't orphaned.
function rowMatchesLocation(row, locId) {
  if (row.loc_id != null) return row.loc_id === locId;
  return locId === DEFAULT_LOC_ID;
}

// Persist one collection snapshot (one row per source, ok or error) for a
// location object { id, name, lat, lon }.
export function insertSnapshot(ts, location, results) {
  const rows = readAll();
  const added = Object.entries(results).map(([source, d]) => ({
    ts,
    loc_id: location.id,
    loc_name: location.name,
    loc_lat: location.lat,
    loc_lon: location.lon,
    source,
    temp_f: d.temp_f ?? null,
    humidity: d.humidity ?? null,
    wind_mph: d.wind_mph ?? null,
    pressure_inhg: d.pressure_inhg ?? null,
    pm25: d.pm25 ?? null,
    aqi: d.aqi ?? null,
    conditions: d.conditions ?? null,
    place: d.place ?? null,
    lat: d.lat ?? null,
    lon: d.lon ?? null,
    source_url: d.source_url ?? null,
    status: d.status,
    error: d.error ?? null,
  }));
  writeAll(rows.concat(added));
  return added.length;
}

// Most recent N distinct snapshots for one location, oldest-first for charting.
export function getHistory(locId, limitSnapshots = 500) {
  const rows = readAll().filter((r) => rowMatchesLocation(r, locId));
  const tsDesc = Array.from(new Set(rows.map((r) => r.ts))).sort().reverse();
  const keep = new Set(tsDesc.slice(0, limitSnapshots));
  return rows.filter((r) => keep.has(r.ts)).sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}

// Total stored readings for one location (all time).
export function countReadings(locId) {
  return readAll().filter((r) => rowMatchesLocation(r, locId)).length;
}

// All readings for one location (no snapshot cap) — used to derive observed daily
// high/low for forecast-accuracy scoring.
export function getReadings(locId) {
  return readAll().filter((r) => rowMatchesLocation(r, locId));
}
