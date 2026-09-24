// First-run setup: a fresh install is seeded with the built-in San Francisco
// location so history/config always have somewhere to hang. That seed is a
// placeholder, not the user's place — the dashboard shows a setup card until
// they replace it (or they already have another location).

import { DEFAULT_LOC_ID, DEFAULT_LOCATION } from "./constants.mjs";

const COORD_EPS = 1e-4;

function sameCoord(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < COORD_EPS;
}

export function isUntouchedSeedLocation(loc) {
  if (!loc || loc.id !== DEFAULT_LOC_ID) return false;
  if (!sameCoord(loc.lat, DEFAULT_LOCATION.lat) || !sameCoord(loc.lon, DEFAULT_LOCATION.lon)) return false;
  return !String(loc.purpleair_sensor_index || "").trim();
}

export function needsFirstRunSetup({ locations } = {}) {
  return Array.isArray(locations) && locations.length === 1 && isUntouchedSeedLocation(locations[0]);
}
