// Per-user view of the shared location pool. Under the platform every signed-in
// person sees only the locations they follow and has their own "active" one;
// the pool itself (settings.json), the collector and the history stay shared,
// so a place two people both track is collected once. Anonymous (single-tenant)
// instances never touch this module.
//
// One small JSON file per user, next to settings.json:
//   <settings dir>/users/<slug>.json  →  { follows: [locId], activeLocationId }
// Same contract as the other stores: plain JSON, atomic write, zero native deps.
// WEATHER_USERS_DIR overrides the directory. A user with no file follows nothing
// and gets the setup card; scripts/seed-users.mjs pre-fills files for existing
// people when identity is switched on.

import fs from "node:fs";
import path from "node:path";
import { settingsFile } from "./settings.mjs";

export function usersDir() {
  return process.env.WEATHER_USERS_DIR || path.join(path.dirname(settingsFile()), "users");
}

function userFile(id) {
  if (!/^[a-z0-9_]{1,96}$/.test(String(id))) throw new Error("bad user id");
  return path.join(usersDir(), `${id}.json`);
}

function normalize(obj) {
  const follows = Array.isArray(obj?.follows) ? obj.follows.filter((s) => typeof s === "string" && s) : [];
  return {
    follows: [...new Set(follows)],
    activeLocationId: typeof obj?.activeLocationId === "string" ? obj.activeLocationId : "",
  };
}

export function getUserPrefs(id) {
  try {
    return normalize(JSON.parse(fs.readFileSync(userFile(id), "utf8")));
  } catch (e) {
    if (e.code === "ENOENT") return normalize(null);
    throw e;
  }
}

export function hasUserPrefs(id) {
  return fs.existsSync(userFile(id));
}

export function saveUserPrefs(id, prefs) {
  const f = userFile(id);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const next = { ...normalize(prefs), updated_at: new Date().toISOString() };
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, f); // atomic replace
  return next;
}

// Follow a pool entry; by default it also becomes the user's active location
// (a freshly added place is the one you want to look at).
export function followLocation(id, locId, { select = true } = {}) {
  const p = getUserPrefs(id);
  if (!p.follows.includes(locId)) p.follows.push(locId);
  if (select || !p.activeLocationId) p.activeLocationId = locId;
  return saveUserPrefs(id, p);
}

export function unfollowLocation(id, locId) {
  const p = getUserPrefs(id);
  p.follows = p.follows.filter((x) => x !== locId);
  if (p.activeLocationId === locId) p.activeLocationId = p.follows[0] || "";
  return saveUserPrefs(id, p);
}

export function setUserActive(id, locId) {
  const p = getUserPrefs(id);
  if (!p.follows.includes(locId)) throw new Error("unknown location id");
  p.activeLocationId = locId;
  return saveUserPrefs(id, p);
}

// Everyone (other than `except`) who follows this pool entry. Scans the users
// directory — a few dozen small files at most.
export function followersOf(locId, { except } = {}) {
  let names = [];
  try {
    names = fs.readdirSync(usersDir());
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const out = [];
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    const uid = n.slice(0, -".json".length);
    if (uid === except) continue;
    try {
      if (getUserPrefs(uid).follows.includes(locId)) out.push(uid);
    } catch {
      /* an unreadable file is nobody's follow */
    }
  }
  return out;
}

// The shared config narrowed to what this user follows, with their own active
// location. Empty `locations` when they follow nothing yet.
export function userConfig(cfg, id) {
  const p = getUserPrefs(id);
  const locations = cfg.locations.filter((l) => p.follows.includes(l.id));
  const activeLocationId = locations.some((l) => l.id === p.activeLocationId)
    ? p.activeLocationId
    : locations[0]?.id || "";
  return { ...cfg, locations, activeLocationId };
}
