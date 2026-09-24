import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { diurnalProjection, sensorRelativeOffsets } from "./accuracy.mjs";

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "weather-acc-"));
  process.env.WEATHER_DB = join(dir, "history.json");
  process.env.WEATHER_FORECASTS = join(dir, "forecasts.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.WEATHER_DB;
  delete process.env.WEATHER_FORECASTS;
});

const LOCATION = { id: "home", name: "Test Home", lat: 37.9, lon: -122.1 };
const NOW = Date.parse("2026-08-21T18:00:00Z");

function paReading(ts, temp) {
  return { ts, loc_id: "home", source: "purpleair", temp_f: temp, status: "ok" };
}

function forecastRow(source, targetDate, high, low) {
  return {
    loc_id: "home",
    source,
    target_date: targetDate,
    made_at: `${targetDate}T06:00:00Z`,
    high_f: high,
    low_f: low,
  };
}

describe("sensorRelativeOffsets", () => {
  it("computes per-source median offsets vs the sensor, robust to one outlier day", () => {
    // Sensor observed highs 82/84/90 (last day is a heat spike), lows all 56.
    writeFileSync(
      process.env.WEATHER_DB,
      JSON.stringify([
        paReading("2026-08-18T22:00:00Z", 82), paReading("2026-08-18T12:00:00Z", 56),
        paReading("2026-08-19T22:00:00Z", 84), paReading("2026-08-19T12:00:00Z", 56),
        paReading("2026-08-20T22:00:00Z", 90), paReading("2026-08-20T12:00:00Z", 56),
      ]),
    );
    // NWS forecasts run 4 cool on normal days, 12 cool on the spike day;
    // Open-Meteo runs 6 cool. Lows are spot on.
    writeFileSync(
      process.env.WEATHER_FORECASTS,
      JSON.stringify([
        forecastRow("nws", "2026-08-18", 78, 56),
        forecastRow("nws", "2026-08-19", 80, 56),
        forecastRow("nws", "2026-08-20", 78, 56),
        forecastRow("open_meteo", "2026-08-18", 76, 56),
        forecastRow("open_meteo", "2026-08-19", 78, 56),
        forecastRow("open_meteo", "2026-08-20", 84, 56),
      ]),
    );
    const rel = sensorRelativeOffsets(LOCATION, { offsetSec: 0, nowMs: NOW });
    expect(rel.reference).toBe("purpleair");
    // NWS high errors: -4, -4, -12 -> median -4 -> offset +4 (the spike does not drag it)
    expect(rel.per_source.nws.high).toEqual({ offset: 4, n: 3 });
    expect(rel.per_source.nws.low).toEqual({ offset: 0, n: 3 });
    expect(rel.per_source.open_meteo.high).toEqual({ offset: 6, n: 3 });
  });

  it("excludes today, forecasts issued after local noon, and days without sensor data", () => {
    writeFileSync(
      process.env.WEATHER_DB,
      JSON.stringify([paReading("2026-08-20T22:00:00Z", 84)]),
    );
    writeFileSync(
      process.env.WEATHER_FORECASTS,
      JSON.stringify([
        forecastRow("nws", "2026-08-21", 70, 50), // today: never scored
        forecastRow("nws", "2026-08-19", 70, 50), // no sensor data that day
        { ...forecastRow("nws", "2026-08-20", 70, 50), made_at: "2026-08-20T15:00:00Z" }, // after noon
      ]),
    );
    const rel = sensorRelativeOffsets(LOCATION, { offsetSec: 0, nowMs: NOW });
    expect(rel.per_source.nws).toBeUndefined();
  });

  it("returns an empty map with no purpleair history (sensor_relative omitted upstream)", () => {
    writeFileSync(process.env.WEATHER_DB, JSON.stringify([]));
    writeFileSync(
      process.env.WEATHER_FORECASTS,
      JSON.stringify([forecastRow("nws", "2026-08-20", 78, 56)]),
    );
    expect(sensorRelativeOffsets(LOCATION, { nowMs: NOW }).per_source).toEqual({});
  });
});

describe("diurnalProjection projCurve", () => {
  // Two identical training days sampled every 2h: 60° at 6am rising to 80° at 2pm,
  // back down through the evening. Profile fractions: 6am=0, 8am=.2, 10am=.5,
  // noon=.8, 2pm=1, 4pm=.9, 6pm=.6, 8pm=.3.
  const shape = [[6, 60], [8, 64], [10, 70], [12, 76], [14, 80], [16, 78], [18, 72], [20, 66]];
  const trainingDays = ["2026-08-19", "2026-08-20"].flatMap((date) =>
    shape.map(([h, t]) => paReading(`${date}T${String(h).padStart(2, "0")}:00:00Z`, t)),
  );

  it("projects the rest of the day through the average daily shape before the peak", () => {
    writeFileSync(
      process.env.WEATHER_DB,
      JSON.stringify([
        ...trainingDays,
        paReading("2026-08-21T06:00:00Z", 60),
        paReading("2026-08-21T08:00:00Z", 64),
        paReading("2026-08-21T10:00:00Z", 70),
      ]),
    );
    const dn = diurnalProjection(LOCATION, { offsetSec: 0, nowMs: Date.parse("2026-08-21T10:30:00Z") });
    // At 10am the curve says we're 50% up the range: (70−60)/0.5 → a 20° range.
    expect(dn.estHigh).toBe(80);
    expect(dn.projCurve[10]).toBe(70); // the shape at the current hour
    expect(dn.projCurve[12]).toBe(76);
    expect(dn.projCurve[14]).toBe(80); // the projected peak = estHigh
    expect(dn.projCurve[18]).toBe(72); // and the evening decline
    expect(dn.projCurve[8]).toBeNull(); // nothing before now
    expect(dn.projCurve[11]).toBeNull(); // no profile data at odd hours
  });

  it("projects from today's realized range in the hour leading into the peak", () => {
    // Add a 1pm training point at 99% of range: the solve refuses fNow ≥ .99,
    // but with the day's range essentially realized the curve continues anyway.
    const nearPeak = [...shape, [13, 79.9]];
    const days = ["2026-08-19", "2026-08-20"].flatMap((date) =>
      nearPeak.map(([h, t]) => paReading(`${date}T${String(h).padStart(2, "0")}:00:00Z`, t)),
    );
    writeFileSync(
      process.env.WEATHER_DB,
      JSON.stringify([
        ...days,
        paReading("2026-08-21T06:00:00Z", 60),
        paReading("2026-08-21T10:00:00Z", 70),
        paReading("2026-08-21T13:00:00Z", 79.9),
      ]),
    );
    const dn = diurnalProjection(LOCATION, { offsetSec: 0, nowMs: Date.parse("2026-08-21T13:30:00Z") });
    expect(dn.estHigh).toBeNull(); // the strict solve still refuses this close to the peak
    expect(dn.projCurve[13]).toBe(79.8); // min + realized range × 0.995
    expect(dn.projCurve[14]).toBe(79.9); // min + realized range × 1.0
    expect(dn.projCurve[18]).toBe(71.9); // and on down the evening shape
  });

  it("pools all sources when the sensor has no depth inside the window", () => {
    const nwsReading = (ts, temp) => ({ ts, loc_id: "home", source: "nws", temp_f: temp, status: "ok" });
    writeFileSync(
      process.env.WEATHER_DB,
      JSON.stringify([
        // A sensor tried once, months ago — must not capture the projection.
        paReading("2026-06-01T14:00:00Z", 75),
        ...["2026-08-19", "2026-08-20"].flatMap((date) =>
          shape.map(([h, t]) => nwsReading(`${date}T${String(h).padStart(2, "0")}:00:00Z`, t))),
        nwsReading("2026-08-21T06:00:00Z", 60),
        nwsReading("2026-08-21T10:00:00Z", 70),
      ]),
    );
    const dn = diurnalProjection(LOCATION, { offsetSec: 0, nowMs: Date.parse("2026-08-21T10:30:00Z") });
    expect(dn.source).toBe("all sources");
    expect(dn.estHigh).toBe(80);
  });

  it("still projects the evening decline once the peak has passed", () => {
    writeFileSync(
      process.env.WEATHER_DB,
      JSON.stringify([
        ...trainingDays,
        ...shape.filter(([h]) => h <= 14).map(([h, t]) =>
          paReading(`2026-08-21T${String(h).padStart(2, "0")}:00:00Z`, t)),
      ]),
    );
    const dn = diurnalProjection(LOCATION, { offsetSec: 0, nowMs: Date.parse("2026-08-21T16:30:00Z") });
    expect(dn.estHigh).toBeNull(); // past the peak — the high is in, not projected
    expect(dn.projCurve[16]).toBe(78); // min + realized range × 0.9
    expect(dn.projCurve[18]).toBe(72);
    expect(dn.projCurve[20]).toBe(66);
  });
});
