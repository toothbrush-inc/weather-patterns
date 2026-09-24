// The four location actions (add / update / remove / select) with the per-user
// rules applied when the caller is known. Anonymous callers get the plain shared
// behaviour from settings.mjs, unchanged.
//
// With a caller, the pool is shared and the follow list is personal:
//   add     — reuse a pool entry at the same spot with the same sensor if one
//             exists (two people tracking one house collect it once), else
//             create one; either way follow it and make it the caller's active.
//   update  — a name change is cosmetic and applies in place. Moving the
//             coordinates or changing the sensor changes what gets collected,
//             so if anyone else follows the entry it is forked: a new pool entry
//             with the change, the caller re-pointed to it, the original left
//             alone for the others.
//   remove  — unfollow; the pool entry is retired only when nobody else follows
//             it (history rows are kept either way, as before).
//   select  — the caller's own active location, never the shared one.

import { getConfig } from "./config.mjs";
import {
  addLocation,
  findPoolLocation,
  removeLocation,
  setActiveLocation,
  updateLocation,
} from "./settings.mjs";
import { followLocation, followersOf, getUserPrefs, setUserActive, unfollowLocation } from "./users.mjs";

function mustFollow(caller, id) {
  if (!getUserPrefs(caller.id).follows.includes(id)) throw new Error("unknown location id");
}

export function addLocationFor(caller, fields) {
  if (!caller) return { location: addLocation(fields), reused: false };
  const existing = findPoolLocation(getConfig().locations, fields);
  const location = existing || addLocation(fields);
  followLocation(caller.id, location.id, { select: true });
  return { location, reused: Boolean(existing) };
}

function movesLocation(patch, base) {
  const num = (v) => (typeof v === "number" ? v : parseFloat(v));
  if (patch.lat != null && Number.isFinite(num(patch.lat)) && num(patch.lat) !== base.lat) return true;
  if (patch.lon != null && Number.isFinite(num(patch.lon)) && num(patch.lon) !== base.lon) return true;
  if ("purpleair_sensor_index" in patch) {
    const next = String(patch.purpleair_sensor_index ?? "").trim();
    if (next !== String(base.purpleair_sensor_index ?? "").trim()) return true;
  }
  return false;
}

export function updateLocationFor(caller, id, patch) {
  if (!caller) return { location: updateLocation(id, patch), forked: false };
  mustFollow(caller, id);
  const base = getConfig().locations.find((l) => l.id === id);
  if (!base) throw new Error("unknown location id");
  const others = followersOf(id, { except: caller.id });
  if (others.length === 0 || !movesLocation(patch, base)) {
    return { location: updateLocation(id, patch), forked: false };
  }
  const forked = addLocation({
    name: patch.name != null && String(patch.name).trim() ? patch.name : base.name,
    lat: patch.lat ?? base.lat,
    lon: patch.lon ?? base.lon,
    purpleair_sensor_index:
      "purpleair_sensor_index" in patch ? patch.purpleair_sensor_index : base.purpleair_sensor_index,
  });
  const wasActive = getUserPrefs(caller.id).activeLocationId === id;
  unfollowLocation(caller.id, id);
  followLocation(caller.id, forked.id, { select: wasActive });
  return { location: forked, forked: true, forkedFrom: id };
}

export function removeLocationFor(caller, id) {
  if (!caller) {
    removeLocation(id);
    return { removed: id, retired: true };
  }
  mustFollow(caller, id);
  unfollowLocation(caller.id, id);
  const retired = followersOf(id, { except: caller.id }).length === 0;
  if (retired) removeLocation(id);
  return { removed: id, retired };
}

export function selectLocationFor(caller, id) {
  if (!caller) return setActiveLocation(id);
  setUserActive(caller.id, id);
  return id;
}
