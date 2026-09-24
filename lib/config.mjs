// Effective configuration = saved settings (settings.json, written by the
// dashboard) layered over environment variables. Locations are user-managed in
// the UI and carry their own PurpleAir sensor selection. Account API keys live
// in the shared vault (lib/vault.mjs), not on this object. NWS and Open-Meteo
// derive entirely from each location's lat/lon (they auto-pick the closest
// station / grid cell).

import { getSettings, ensureSeededLocations } from "./settings.mjs";
import { DEFAULT_LOCATION } from "./constants.mjs";

export function getConfig() {
  const env = process.env;
  const saved = getSettings();

  // Locations: use the saved list; if empty (fresh install or pre-locations
  // settings), seed and persist a "default" location from LOCATION_* env or the
  // built-in default. The default keeps id "default" so pre-existing history
  // (rows without a loc_id) stays attached to it — see lib/db.mjs.
  let locations = Array.isArray(saved.locations) ? saved.locations.filter(isValidLocation) : [];
  if (locations.length === 0) {
    locations = ensureSeededLocations({
      name: env.LOCATION_NAME || DEFAULT_LOCATION.name,
      lat: env.LOCATION_LAT ? parseFloat(env.LOCATION_LAT) : DEFAULT_LOCATION.lat,
      lon: env.LOCATION_LON ? parseFloat(env.LOCATION_LON) : DEFAULT_LOCATION.lon,
    }).filter(isValidLocation);
  }

  const activeLocationId = locations.some((l) => l.id === saved.activeLocationId)
    ? saved.activeLocationId
    : locations[0].id;

  return {
    locations,
    activeLocationId,
    collectToken: env.COLLECT_TOKEN || "",
  };
}

export function isValidLocation(l) {
  return (
    l &&
    typeof l.id === "string" &&
    Number.isFinite(l.lat) &&
    Number.isFinite(l.lon)
  );
}

// Resolve a location id to the location object, falling back to the active one.
// Null only for a per-user view that follows nothing yet (lib/users.mjs); the
// shared pool is always seeded with at least one location.
export function resolveLocation(cfg, id) {
  return cfg.locations.find((l) => l.id === id) ||
    cfg.locations.find((l) => l.id === cfg.activeLocationId) ||
    cfg.locations[0] ||
    null;
}
