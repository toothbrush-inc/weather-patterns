import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildAlerts, historyStats } from "./alerts.mjs";

// ---------------------------------------------------------- buildAlerts ------
// Pure rules — everything network/disk is passed in.

const QUIET_STATS = {
  wind: { p95: 8, max: 12, n: 120 },
  aqi: { p95: 45, max: 60, n: 120 },
  high: { mean: 71, sd: 2, n: 10 },
  low: { mean: 54, sd: 2, n: 10 },
};

const hoursWith = (cells) => {
  const hours = Array.from({ length: 24 }, (_, hour) => ({
    hour, temp_f: null, precip_prob: null, precip_in: null, wind_mph: 6, gust_mph: null,
  }));
  for (const c of cells) hours[c.hour] = { ...hours[c.hour], ...c };
  return hours;
};

describe("buildAlerts", () => {
  it("stays silent on a normal day", () => {
    const alerts = buildAlerts({
      consensus: { high_f: 70, low_f: 55, precip_prob: 5, precip_in: 0 },
      hours: hoursWith([]),
      aqiToday: { max: 50, maxHour: 14 },
      stats: QUIET_STATS,
    });
    expect(alerts).toEqual([]);
  });

  it("flags likely rain with the starting hour, escalating with probability", () => {
    const hours = hoursWith([{ hour: 13, precip_prob: 60 }]);
    const notice = buildAlerts({ consensus: { precip_prob: 55, precip_in: 0.1 }, hours });
    expect(notice).toHaveLength(1);
    expect(notice[0]).toMatchObject({ kind: "rain", severity: "notice" });
    expect(notice[0].detail).toContain("1pm");
    expect(notice[0].detail).toContain("0.1″");

    const warning = buildAlerts({ consensus: { precip_prob: 80, precip_in: 0.3 }, hours });
    expect(warning[0]).toMatchObject({ kind: "rain", severity: "warning" });
  });

  it("upgrades rain to a storm alert when any source mentions thunder", () => {
    const alerts = buildAlerts({
      consensus: { precip_prob: 30 },
      forecasts: { nws: { status: "ok", conditions: "Scattered Thunderstorms" } },
      hours: hoursWith([]),
    });
    expect(alerts[0]).toMatchObject({ kind: "storm", severity: "warning" });
  });

  it("flags absolutely high wind even with no history baseline", () => {
    const alerts = buildAlerts({
      consensus: {},
      hours: hoursWith([{ hour: 15, wind_mph: 32, gust_mph: 40 }]),
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "wind", severity: "warning", headline: "High wind today" });
    expect(alerts[0].detail).toContain("32 mph");
    expect(alerts[0].detail).toContain("3pm");
  });

  it("flags wind that is only unusual relative to this location's normal", () => {
    const hours = hoursWith([{ hour: 16, wind_mph: 17 }]);
    const alerts = buildAlerts({ consensus: {}, hours, stats: QUIET_STATS });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "wind", severity: "notice", headline: "Windier than usual today" });
    expect(alerts[0].detail).toContain("~8 mph");

    // Same wind with too little history: not strong in absolute terms, no baseline → silent.
    const thin = { ...QUIET_STATS, wind: { p95: 8, max: 12, n: 10 } };
    expect(buildAlerts({ consensus: {}, hours, stats: thin })).toEqual([]);
  });

  it("flags bad air on the standard AQI bands and on the local normal", () => {
    const unhealthy = buildAlerts({ consensus: {}, hours: hoursWith([]), aqiToday: { max: 160, maxHour: 12 } });
    expect(unhealthy[0]).toMatchObject({ kind: "aqi", severity: "warning", headline: "Unhealthy air quality today" });

    const unusual = buildAlerts({
      consensus: {}, hours: hoursWith([]), aqiToday: { max: 85, maxHour: 15 }, stats: QUIET_STATS,
    });
    expect(unusual[0]).toMatchObject({ kind: "aqi", severity: "notice" });
    expect(unusual[0].headline).toContain("worse than usual");
  });

  it("flags an abnormal high or low against the recent normal", () => {
    const heat = buildAlerts({
      consensus: { high_f: 84, low_f: 55 }, hours: hoursWith([]), stats: QUIET_STATS,
    });
    expect(heat).toHaveLength(1);
    expect(heat[0]).toMatchObject({ kind: "heat", severity: "notice" });
    expect(heat[0].detail).toContain("~71°");

    const cold = buildAlerts({
      consensus: { high_f: 70, low_f: 39 }, hours: hoursWith([]),
      stats: { ...QUIET_STATS, low: { mean: 54, sd: 3, n: 12 } },
    });
    expect(cold[0]).toMatchObject({ kind: "cold", severity: "warning" });
  });

  it("orders warnings before notices", () => {
    const alerts = buildAlerts({
      consensus: { precip_prob: 45 }, // notice
      hours: hoursWith([{ hour: 15, wind_mph: 35 }]), // warning
    });
    expect(alerts.map((a) => a.severity)).toEqual(["warning", "notice"]);
  });
});

// --------------------------------------------------------- historyStats ------

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "weather-alerts-"));
  process.env.WEATHER_DB = join(dir, "history.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.WEATHER_DB;
});

const NOW = Date.parse("2026-08-21T18:00:00Z");

const reading = (ts, source, fields) => ({
  ts, loc_id: "home", source, status: "ok",
  temp_f: null, wind_mph: null, aqi: null, ...fields,
});

describe("historyStats", () => {
  it("builds wind/aqi percentiles and daily temp normals, excluding today and stale days", () => {
    const day = (date) => [
      reading(`${date}T06:00:00Z`, "nws", { temp_f: 60, wind_mph: 5 }),
      reading(`${date}T14:00:00Z`, "nws", { temp_f: 80, wind_mph: 5 }),
      reading(`${date}T06:00:00Z`, "open_meteo", { temp_f: 62, wind_mph: 7, aqi: 40 }),
      reading(`${date}T14:00:00Z`, "open_meteo", { temp_f: 82, wind_mph: 7, aqi: 40 }),
    ];
    writeFileSync(
      process.env.WEATHER_DB,
      JSON.stringify([
        ...day("2026-08-19"),
        ...day("2026-08-20"),
        reading("2026-08-21T06:00:00Z", "nws", { temp_f: 95, wind_mph: 40, aqi: 300 }), // today: excluded
        reading("2026-07-01T06:00:00Z", "nws", { temp_f: 95, wind_mph: 40, aqi: 300 }), // out of window
      ]),
    );
    const stats = historyStats("home", { offsetSec: 0, nowMs: NOW });
    expect(stats.wind.n).toBe(8);
    expect(stats.wind.p95).toBe(7);
    expect(stats.aqi).toEqual({ p95: 40, max: 40, n: 4 });
    // Each day's high = mean of per-source daily maxes (81), low likewise (61).
    expect(stats.high).toEqual({ mean: 81, sd: 0, n: 2 });
    expect(stats.low).toEqual({ mean: 61, sd: 0, n: 2 });
  });

  it("returns empty baselines with no history", () => {
    writeFileSync(process.env.WEATHER_DB, JSON.stringify([]));
    const stats = historyStats("home", { offsetSec: 0, nowMs: NOW });
    expect(stats.wind).toEqual({ p95: null, max: null, n: 0 });
    expect(stats.high).toEqual({ mean: null, sd: null, n: 0 });
  });
});
