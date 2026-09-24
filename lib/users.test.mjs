import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getConfig } from "./config.mjs";
import { addLocationFor, removeLocationFor, selectLocationFor, updateLocationFor } from "./location-actions.mjs";
import { scopeFor } from "./scope.mjs";
import {
  followLocation,
  followersOf,
  getUserPrefs,
  setUserActive,
  unfollowLocation,
  userConfig,
  usersDir,
} from "./users.mjs";

let dir;
const ALICE = "alice_at_example_com";
const BOB = "bob_at_example_com";

function seed() {
  writeFileSync(
    process.env.WEATHER_SETTINGS,
    JSON.stringify({
      locations: [
        { id: "sf", name: "San Francisco", lat: 37.7749, lon: -122.4194, purpleair_sensor_index: "" },
        { id: "laf", name: "Lafayette", lat: 37.8858, lon: -122.118, purpleair_sensor_index: "111" },
      ],
      activeLocationId: "sf",
    }),
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "weather-users-"));
  process.env.WEATHER_SETTINGS = join(dir, "settings.json");
  delete process.env.WEATHER_USERS_DIR;
  delete process.env.WEATHER_IDENTITY_HEADER;
  seed();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("user prefs store", () => {
  it("lives next to settings.json and starts empty", () => {
    expect(usersDir()).toBe(join(dir, "users"));
    expect(getUserPrefs(ALICE)).toEqual({ follows: [], activeLocationId: "" });
  });

  it("follow / unfollow / active", () => {
    followLocation(ALICE, "sf");
    followLocation(ALICE, "laf", { select: false });
    expect(getUserPrefs(ALICE)).toMatchObject({ follows: ["sf", "laf"], activeLocationId: "sf" });
    setUserActive(ALICE, "laf");
    expect(getUserPrefs(ALICE).activeLocationId).toBe("laf");
    expect(() => setUserActive(ALICE, "nope")).toThrow(/unknown location/);
    unfollowLocation(ALICE, "laf");
    expect(getUserPrefs(ALICE)).toMatchObject({ follows: ["sf"], activeLocationId: "sf" });
    expect(readdirSync(usersDir())).toEqual([`${ALICE}.json`]);
  });

  it("rejects a user id that is not a slug", () => {
    expect(() => getUserPrefs("../etc/passwd")).toThrow(/bad user id/);
  });

  it("followersOf counts everyone else", () => {
    followLocation(ALICE, "sf");
    followLocation(BOB, "sf");
    expect(followersOf("sf").sort()).toEqual([ALICE, BOB]);
    expect(followersOf("sf", { except: ALICE })).toEqual([BOB]);
    expect(followersOf("laf")).toEqual([]);
  });

  it("userConfig narrows the pool and falls back to the first follow", () => {
    followLocation(ALICE, "laf");
    const cfg = userConfig(getConfig(), ALICE);
    expect(cfg.locations.map((l) => l.id)).toEqual(["laf"]);
    expect(cfg.activeLocationId).toBe("laf");
    expect(userConfig(getConfig(), BOB)).toMatchObject({ locations: [], activeLocationId: "" });
  });
});

describe("scopeFor", () => {
  it("is the whole pool when identity is off", () => {
    const s = scopeFor(new Headers());
    expect(s.denied).toBe(false);
    expect(s.caller).toBeNull();
    expect(s.cfg.locations).toHaveLength(2);
  });

  it("is denied without the header once identity is on", () => {
    process.env.WEATHER_IDENTITY_HEADER = "X-Forwarded-User";
    expect(scopeFor(new Headers()).denied).toBe(true);
  });

  it("is the caller's follows with the header", () => {
    process.env.WEATHER_IDENTITY_HEADER = "X-Forwarded-User";
    followLocation(ALICE, "laf");
    const s = scopeFor(new Headers({ "X-Forwarded-User": "alice@example.com" }));
    expect(s.denied).toBe(false);
    expect(s.caller.id).toBe(ALICE);
    expect(s.pool.locations).toHaveLength(2);
    expect(s.cfg.locations.map((l) => l.id)).toEqual(["laf"]);
  });
});

describe("location actions with a caller", () => {
  const alice = { id: ALICE, email: "alice@example.com" };
  const bob = { id: BOB, email: "bob@example.com" };

  it("anonymous callers keep the shared behaviour", () => {
    const { location } = addLocationFor(null, { name: "Oakland", lat: 37.8, lon: -122.27 });
    expect(getConfig().locations.map((l) => l.id)).toContain(location.id);
    expect(readdirSync(dir)).not.toContain("users");
    selectLocationFor(null, location.id);
    expect(getConfig().activeLocationId).toBe(location.id);
  });

  it("add reuses a pool entry at the same spot with the same sensor", () => {
    const { location, reused } = addLocationFor(alice, { name: "Laf again", lat: 37.88581, lon: -122.11801, purpleair_sensor_index: "111" });
    expect(reused).toBe(true);
    expect(location.id).toBe("laf");
    expect(getConfig().locations).toHaveLength(2);
    expect(getUserPrefs(ALICE)).toMatchObject({ follows: ["laf"], activeLocationId: "laf" });
    // Same spot, different sensor: a different thing to collect.
    const other = addLocationFor(bob, { name: "Laf", lat: 37.8858, lon: -122.118, purpleair_sensor_index: "" });
    expect(other.reused).toBe(false);
    expect(getConfig().locations).toHaveLength(3);
  });

  it("add creates and follows, and does not move the shared active location", () => {
    const { location } = addLocationFor(alice, { name: "Oakland", lat: 37.8, lon: -122.27 });
    expect(getUserPrefs(ALICE).activeLocationId).toBe(location.id);
    expect(getConfig().activeLocationId).toBe("sf");
    expect(() => selectLocationFor(alice, "sf")).toThrow(/unknown location/);
    selectLocationFor(alice, location.id);
    expect(getConfig().activeLocationId).toBe("sf");
  });

  it("update: a rename applies in place even when shared; a move forks", () => {
    followLocation(ALICE, "laf");
    followLocation(BOB, "laf");
    const renamed = updateLocationFor(alice, "laf", { name: "Lafayette, CA" });
    expect(renamed.forked).toBe(false);
    expect(getConfig().locations.find((l) => l.id === "laf").name).toBe("Lafayette, CA");

    const moved = updateLocationFor(alice, "laf", { purpleair_sensor_index: "222" });
    expect(moved.forked).toBe(true);
    expect(moved.location.id).not.toBe("laf");
    expect(moved.location).toMatchObject({ name: "Lafayette, CA", lat: 37.8858, lon: -122.118, purpleair_sensor_index: "222" });
    expect(getUserPrefs(ALICE)).toMatchObject({ follows: [moved.location.id], activeLocationId: moved.location.id });
    expect(getUserPrefs(BOB).follows).toEqual(["laf"]);
    expect(getConfig().locations.find((l) => l.id === "laf").purpleair_sensor_index).toBe("111");
  });

  it("update edits in place when nobody else follows it", () => {
    followLocation(ALICE, "laf");
    const r = updateLocationFor(alice, "laf", { lat: 37.9, lon: -122.1 });
    expect(r.forked).toBe(false);
    expect(getConfig().locations.find((l) => l.id === "laf")).toMatchObject({ lat: 37.9, lon: -122.1 });
    expect(() => updateLocationFor(alice, "sf", { name: "x" })).toThrow(/unknown location/);
  });

  it("remove unfollows, and retires the pool entry only when nobody is left", () => {
    followLocation(ALICE, "laf");
    followLocation(BOB, "laf");
    expect(removeLocationFor(alice, "laf")).toEqual({ removed: "laf", retired: false });
    expect(getConfig().locations.map((l) => l.id)).toContain("laf");
    expect(getUserPrefs(ALICE).follows).toEqual([]);
    expect(removeLocationFor(bob, "laf")).toEqual({ removed: "laf", retired: true });
    expect(getConfig().locations.map((l) => l.id)).toEqual(["sf"]);
  });
});
