// Runtime-editable settings — a small JSON file the dashboard can write, so a
// user can manage locations from the UI without editing files by hand. Account
// API keys live in the shared vault (lib/vault.mjs); leftover purpleair /
// open_meteo fields here are a read fallback only. Read by getConfig() for
// locations. Mirrors db.mjs: plain JSON, atomic write, zero native dependencies.
// Shape: { locations: [{ id, name, lat, lon, purpleair_sensor_index }],
//          activeLocationId }

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_LOC_ID } from "./constants.mjs";

export const CREDENTIAL_PROVIDERS = {
  purpleair: { settingsKey: "purpleair", field: "read_key", env: "PURPLEAIR_READ_KEY" },
  open_meteo: { settingsKey: "open_meteo", field: "api_key", env: "OPEN_METEO_API_KEY" },
};

function file() {
  return process.env.WEATHER_SETTINGS || path.join(process.cwd(), "settings.json");
}

// Exported so the per-user store (lib/users.mjs) can live next to it.
export function settingsFile() {
  return file();
}

export function getSettings() {
  try {
    const obj = JSON.parse(fs.readFileSync(file(), "utf8"));
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
  } catch (e) {
    if (e.code === "ENOENT") return {};
    throw e;
  }
}

// Deep-merge a partial update (one level deep, enough for our { source: { field } }
// shape) over the saved settings and persist atomically. A field present in the
// partial is written even when empty (so callers can clear a key); a field absent
// is left unchanged.
export function saveSettings(partial) {
  const cur = getSettings();
  const next = { ...cur };
  for (const [k, v] of Object.entries(partial || {})) {
    next[k] =
      v && typeof v === "object" && !Array.isArray(v) ? { ...(cur[k] || {}), ...v } : v;
  }
  const f = file();
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, f); // atomic replace, avoids partial-write corruption
  return next;
}

// ---- Location management ------------------------------------------------
// These operate on the raw saved array; getConfig() handles seeding a default
// when none exist. A valid location is { id, name, lat, lon } with finite coords.

function rawLocations() {
  const arr = getSettings().locations;
  return Array.isArray(arr) ? arr : [];
}

function normCoord(v) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

export function addLocation({ name, lat, lon, purpleair_sensor_index }) {
  const la = normCoord(lat), lo = normCoord(lon);
  if (la == null || lo == null) throw new Error("location needs numeric lat/lon");
  if (la < -90 || la > 90 || lo < -180 || lo > 180) throw new Error("lat/lon out of range");
  const loc = {
    id: randomUUID().slice(0, 8),
    name: String(name || "").trim() || `${la}, ${lo}`,
    lat: la,
    lon: lo,
    purpleair_sensor_index: String(purpleair_sensor_index ?? "").trim(),
  };
  const locations = [...rawLocations(), loc];
  // Auto-select the first location added so the dashboard has something to show.
  const cur = getSettings();
  saveSettings({ locations, activeLocationId: cur.activeLocationId || loc.id });
  return loc;
}

// A pool entry already at this spot (within ~10 m) with the same PurpleAir
// sensor, or null. Used with a caller so two people who track the same place
// share one collected location instead of collecting it twice.
const SAME_SPOT_DEG = 1e-4;
export function findPoolLocation(locations, { lat, lon, purpleair_sensor_index }) {
  const la = normCoord(lat), lo = normCoord(lon);
  if (la == null || lo == null) return null;
  const sensor = String(purpleair_sensor_index ?? "").trim();
  return (
    locations.find(
      (l) =>
        Math.abs(l.lat - la) < SAME_SPOT_DEG &&
        Math.abs(l.lon - lo) < SAME_SPOT_DEG &&
        String(l.purpleair_sensor_index ?? "").trim() === sensor,
    ) || null
  );
}

export function updateLocation(id, patch) {
  const locations = rawLocations().map((l) => {
    if (l.id !== id) return l;
    const next = { ...l };
    if (patch.name != null) next.name = String(patch.name).trim() || l.name;
    if (patch.lat != null) next.lat = normCoord(patch.lat) ?? l.lat;
    if (patch.lon != null) next.lon = normCoord(patch.lon) ?? l.lon;
    if ("purpleair_sensor_index" in patch) next.purpleair_sensor_index = String(patch.purpleair_sensor_index ?? "").trim();
    return next;
  });
  saveSettings({ locations });
  return locations.find((l) => l.id === id) || null;
}

export function removeLocation(id) {
  const locations = rawLocations().filter((l) => l.id !== id);
  const cur = getSettings();
  const activeLocationId =
    cur.activeLocationId === id ? locations[0]?.id || "" : cur.activeLocationId;
  saveSettings({ locations, activeLocationId });
  return locations;
}

export function setActiveLocation(id) {
  if (!rawLocations().some((l) => l.id === id)) throw new Error("unknown location id");
  saveSettings({ activeLocationId: id });
  return id;
}

// One-time migration: when no locations exist yet, seed a persistent "default"
// location from the given coords, carrying over any legacy top-level PurpleAir
// sensor so an existing setup keeps working. Persisting (rather than seeding in
// memory each call) means pre-existing history — rows with no loc_id, attributed
// to "default" — and the chosen sensor survive once the user adds more locations.
// No-op once any location is saved.
export function ensureSeededLocations({ name, lat, lon }) {
  const cur = getSettings();
  if (Array.isArray(cur.locations) && cur.locations.length > 0) return cur.locations;
  const loc = {
    id: DEFAULT_LOC_ID,
    name: String(name || "").trim() || `${lat}, ${lon}`,
    lat,
    lon,
    purpleair_sensor_index: String(cur.purpleair?.sensor_index ?? "").trim(),
  };
  saveSettings({ locations: [loc], activeLocationId: cur.activeLocationId || loc.id });
  return [loc];
}

// ---- Credentials (vault-shaped: stored here, never returned unmasked) ------
// PurpleAir READ key is required for sensors. Open-Meteo api_key is optional
// (free tier works without it; commercial/customer API needs one).

export function maskSecret(v) {
  const s = String(v || "");
  if (!s) return "";
  return s.length <= 4 ? "••••" : "••••" + s.slice(-4);
}

export function credentialView(savedVal, envVal) {
  if (savedVal) return { set: true, masked: maskSecret(savedVal), origin: "saved" };
  if (envVal) return { set: true, masked: maskSecret(envVal), origin: "env" };
  return { set: false, masked: "", origin: "none" };
}

export function getCredentialViews() {
  const s = getSettings();
  const env = process.env;
  const out = {};
  for (const [provider, spec] of Object.entries(CREDENTIAL_PROVIDERS)) {
    out[provider] = credentialView(s[spec.settingsKey]?.[spec.field], env[spec.env]);
  }
  return out;
}

export function setCredential(provider, apiKey) {
  const spec = CREDENTIAL_PROVIDERS[provider];
  if (!spec) throw new Error(`unknown credential provider: ${provider}`);
  saveSettings({ [spec.settingsKey]: { [spec.field]: String(apiKey ?? "").trim() } });
  return getCredentialViews()[provider];
}
