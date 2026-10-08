import { describe, expect, it } from "vitest";

import { forecastOutlook, hourlyForDate } from "./forecast.mjs";

const DATE = "2026-08-21";

describe("hourlyForDate", () => {
  it("averages temps, keeps per-source values, and takes the max of the risk fields", () => {
    const results = {
      nws: {
        status: "ok",
        byHour: { [DATE]: { 14: { temp_f: 70, precip_prob: 10, precip_in: null, wind_mph: 10, gust_mph: null } } },
      },
      open_meteo: {
        status: "ok",
        byHour: { [DATE]: { 14: { temp_f: 72.5, precip_prob: 30, precip_in: 0.02, wind_mph: 12, gust_mph: 20 } } },
      },
      broken: { status: "error", error: "nope" },
    };
    const { date, hours } = hourlyForDate(results, DATE);
    expect(date).toBe(DATE);
    expect(hours).toHaveLength(24);
    expect(hours[14]).toEqual({
      hour: 14,
      temp_f: 71.3,
      by: { nws: 70, open_meteo: 72.5 },
      precip_prob: 30,
      precip_in: 0.02,
      wind_mph: 12,
      gust_mph: 20,
      conditions: null,
      is_day: null,
    });
    // An hour no source covers stays null across the board.
    expect(hours[3]).toEqual({
      hour: 3, temp_f: null, by: {}, precip_prob: null, precip_in: null, wind_mph: null, gust_mph: null, conditions: null, is_day: null,
    });
  });

  it("handles a missing date and sources without hourly data", () => {
    const results = { nws: { status: "ok", byDate: {} } };
    expect(hourlyForDate(results, null).hours.every((h) => h.temp_f === null)).toBe(true);
    expect(hourlyForDate(results, DATE).hours[0].by).toEqual({});
  });

  it("preserves nighttime and falls back to a source with hourly conditions", () => {
    const results = {
      nws: { status: "ok", byHour: { [DATE]: { 23: { temp_f: 60 } } } },
      open_meteo: { status: "ok", byHour: {
        [DATE]: { 23: { conditions: "Clear sky", is_day: false } },
        "2026-08-22": { 0: { temp_f: 58, conditions: "Fog", is_day: false } },
      } },
    };
    expect(hourlyForDate(results, DATE).hours[23]).toMatchObject({ conditions: "Clear sky", is_day: false });
    expect(hourlyForDate(results, "2026-08-22").hours[0]).toMatchObject({ temp_f: 58, conditions: "Fog", is_day: false });
  });
});

describe("forecastOutlook", () => {
  const day = (high_f, low_f) => ({ high_f, low_f, conditions: null, precip_prob: null, precip_in: null });
  it("lists the days after a date, counting the sources behind each, until nobody forecasts", () => {
    const results = {
      nws: { status: "ok", byDate: { "2026-08-22": day(80, 60), "2026-08-23": day(78, 58) } },
      open_meteo: { status: "ok", byDate: { "2026-08-22": day(84, 62), "2026-08-23": day(76, 56), "2026-08-24": day(70, 50) } },
      broken: { status: "error", error: "nope" },
    };
    const days = forecastOutlook(results, "2026-08-21", 9);
    expect(days.map((d) => [d.date, d.sources, d.consensus.high_f, d.consensus.low_f])).toEqual([
      ["2026-08-22", 2, 82, 61],
      ["2026-08-23", 2, 77, 57],
      ["2026-08-24", 1, 70, 50],
    ]);
    expect(forecastOutlook(results, "2026-08-21", 1)).toHaveLength(1);
    expect(forecastOutlook(results, null, 9)).toEqual([]);
  });
});
