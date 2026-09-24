import { describe, expect, it } from "vitest";
import { SCENARIOS, buildScenario } from "./scenarios.mjs";
import { adjustedDailyRange, adjustedValue, breachAt, comparableBounds, consensusBiasFor, fitCurve } from "./forecast-adjustment";

// What the chart draws for an elapsed hour on today: the sensor's own observation,
// and the source forecast fitted to the corrected daily high/low learned from earlier
// days. Mirrors Dashboard's dailyRanges().forecast → TodayChart's fitCurve — keep the
// derivation here in step with that one.
function todayAt(s, hour) {
  const off = s.forecast.utc_offset_seconds * 1000;
  const acc = s.accuracy;
  const reading = s.data.history.find((r) => r.source === "purpleair"
    && new Date(Date.parse(r.ts) + off).toISOString().slice(0, 10) === acc.todayLocal
    && new Date(Date.parse(r.ts) + off).getUTCHours() === hour);
  const hours = new Map(s.forecast.hourly.hours.map((h) => [h.hour, h.temp_f]));
  const source = Array.from({ length: 24 }, (_, h) => hours.get(h) ?? null);
  const adjusted = fitCurve(source, adjustedDailyRange(s.forecast.consensus, acc));
  return { observed: reading?.temp_f ?? null, adjusted: adjusted[hour] };
}

describe("weather scenario contracts", () => {
  for (const { id } of SCENARIOS) it(`${id}: deterministic, serializable, date-consistent inputs`, () => {
    const s = buildScenario(id);
    expect(buildScenario(id)).toEqual(s);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(s.data.history.every((r) => Date.parse(r.ts) <= s.nowMs)).toBe(true);
    expect(s.accuracy?.daily.every((d) => d.date < s.accuracy.todayLocal) ?? true).toBe(true);
    if (s.forecast) {
      expect(s.forecast.hourly.hours).toHaveLength(24);
      expect(s.forecast.hourlyTomorrow.hours).toHaveLength(24);
      expect(s.forecast.hourly.date).toBe(s.forecast.date);
      expect(s.forecast.hourlyTomorrow.date).toBe(s.forecast.tomorrow.date);
      expect(s.forecast.tomorrow.date > s.forecast.date).toBe(true);
    }
  });

  it("scores equal and opposite local biases from completed observations", () => {
    for (const [id, correction] of [["warmer", 6], ["cooler", -6], ["on-track", 0]]) {
      const s = buildScenario(id);
      const meanBias = s.accuracy.perSource.reduce((n, p) => n + p.vsPurpleair.high.bias, 0) / 2;
      expect(-meanBias).toBeCloseTo(correction);
      expect(s.accuracy.scoredDays).toBe(12);
    }
  });
  it("removes the mean bias but leaves today's departure from it", () => {
    const s = buildScenario("residual");
    // Same systematic correction as `warmer`, learned over the same 12 days.
    expect(consensusBiasFor(s.accuracy, "high")).toMatchObject({ bias: -6, n: 12 });
    const errors = s.accuracy.daily
      .filter((d) => d.paHigh != null && Object.keys(d.sources).length)
      .map((d) => {
        const v = Object.values(d.sources).map((x) => x.forecastHigh).filter((x) => x != null);
        return Math.round(v.reduce((a, b) => a + b, 0) / v.length - d.paHigh);
      });
    expect(new Set(errors).size).toBeGreaterThan(1);
    // The point of the scenario: the adjusted curve does NOT land on the observations.
    const { observed, adjusted } = todayAt(s, 9);
    expect(observed - adjusted).toBeCloseTo(4, 1);
  });
  it("keeps every other scenario's adjustment exact, so residual is the odd one out", () => {
    for (const id of ["warmer", "cooler", "on-track"]) {
      const { observed, adjusted } = todayAt(buildScenario(id), 9);
      expect(observed - adjusted).toBeCloseTo(0, 1);
    }
  });
  it("projects the morning peak and retains only future evening points", () => {
    expect(buildScenario("warmer").accuracy.diurnal.estHigh).toBe(84);
    const evening = buildScenario("after-peak").accuracy.diurnal;
    expect(evening.estHigh).toBeNull();
    expect(evening.projCurve.slice(0, 20).every((v) => v == null)).toBe(true);
    expect(evening.projCurve.slice(20).some((v) => v != null)).toBe(true);
  });
  it("does not invent calibration or projections without history", () => {
    for (const id of ["new-sensor", "empty"]) {
      const s = buildScenario(id);
      expect(s.accuracy.scoredDays).toBe(0);
      expect(s.accuracy.diurnal).toBeNull();
      expect(s.accuracy.perSource.every((p) => p.vsPurpleair.high == null)).toBe(true);
    }
    expect(buildScenario("no-sensor").accuracy.hasPurpleair).toBe(false);
  });
  it("contains real high and low breaches in today’s observations", () => {
    const high = buildScenario("high-breach"), low = buildScenario("low-breach");
    expect(high.accuracy.provisional[0].purpleairSoFar.high_f).toBeGreaterThan(high.forecast.consensus.high_f);
    expect(low.accuracy.provisional[0].purpleairSoFar.low_f).toBeLessThan(low.forecast.consensus.low_f);
  });
  it("retains missing hours and separates provider errors from zero values", () => {
    expect(buildScenario("gaps").forecast.hourly.hours[15].temp_f).toBeNull();
    const failed = buildScenario("source-failure");
    expect(failed.forecast.forecasts.nws.status).toBe("error");
    expect(failed.forecast.consensus.high_f).toBe(failed.forecast.forecasts.open_meteo.high_f);
    expect(buildScenario("forecast-outage").forecast).toBeNull();
    expect(buildScenario("accuracy-outage").accuracy).toBeNull();
  });
  it("generates weather alerts and meaningful outlier counts", () => {
    expect(buildScenario("storm").forecast.alerts.map((a) => a.kind)).toEqual(expect.arrayContaining(["storm", "wind", "aqi"]));
    expect(buildScenario("warmer").data.outliers.purpleair).toBeGreaterThan(0);
  });
  it("splits the bias by end when the source runs warm on highs only", () => {
    const s = buildScenario("asymmetric");
    expect(consensusBiasFor(s.accuracy, "high")).toMatchObject({ bias: -8, n: 12 });
    expect(consensusBiasFor(s.accuracy, "low")).toMatchObject({ bias: 0, n: 12 });
    // The chart pools the two ends into one offset; the advice card corrects each end
    // on its own. Both numbers reach the screen, so pin the gap between them: the
    // pooled curve lands 4F under the high the per-end correction expects.
    const pooled = consensusBiasFor(s.accuracy, "mean");
    expect(pooled.bias).toBe(-4);
    const fcHigh = s.forecast.consensus.high_f;
    expect(adjustedValue(fcHigh, consensusBiasFor(s.accuracy, "high"))).toBe(fcHigh + 8);
    expect(adjustedValue(fcHigh, pooled)).toBe(fcHigh + 4);
  });
  it("will not train the daily shape on a sensor too shallow to support one", () => {
    const s = buildScenario("sparse-sensor");
    // Scoreable for bias against the sensor...
    expect(s.accuracy.hasPurpleair).toBe(true);
    expect(consensusBiasFor(s.accuracy, "mean")).toMatchObject({ bias: -6, n: 1 });
    // ...but under the 16-sample floor the shape needs, so it falls back to the
    // pooled sources. The correction and the projection are then in frames 6F apart,
    // which is why the chart must not splice them into one curve.
    expect(s.accuracy.diurnal.source).toBe("all sources");
    expect(s.accuracy.diurnal.estHigh).toBe(s.forecast.consensus.high_f);
  });
  it("does not read source disagreement as a wider daily swing", () => {
    const s = buildScenario("pooled-spread");
    expect(s.accuracy.hasPurpleair).toBe(false);
    expect(s.accuracy.diurnal.source).toBe("all sources");
    // NWS and Open-Meteo sit 14F apart, so pooling them inflates each day's apparent
    // range and the projected high overshoots what either source forecast.
    expect(s.accuracy.diurnal.estHigh).toBeGreaterThan(s.forecast.consensus.high_f);
  });
  it("does not call a sensor's own offset a blown forecast", () => {
    // Today's running high/low in whichever frame reported them, against the forecast
    // bounds restated in that same frame -- what ForecastNowCheck compares.
    const nowCheck = (id) => {
      const s = buildScenario(id), prov = s.accuracy.provisional;
      const pa = prov.find((x) => x.purpleairSoFar)?.purpleairSoFar ?? null;
      const pick = (f, key) => { const v = prov.map((x) => x.observedSoFar?.[key]).filter((n) => n != null); return v.length ? f(...v) : null; };
      const high = pa ? pa.high_f : pick(Math.max, "high_f");
      const low = pa ? pa.low_f : pick(Math.min, "low_f");
      const raw = { high: s.forecast.consensus.high_f, low: s.forecast.consensus.low_f };
      const bounds = comparableBounds(raw.high, raw.low, s.accuracy, pa ? "sensor" : "sources");
      return { bounds, corrected: breachAt(bounds, high, low), uncorrected: breachAt(raw, high, low) };
    };
    // A 6F-warm sensor sitting exactly on its corrected forecast read as a breach
    // against the raw bounds -- every warm afternoon, and the mirror on cool mornings.
    const warm = nowCheck("warmer");
    expect(warm.uncorrected.highBlown).toBe(true);
    expect(warm.corrected.highBlown).toBe(false);
    const cool = nowCheck("cooler");
    expect(cool.uncorrected.lowBlown).toBe(true);
    expect(cool.corrected.lowBlown).toBe(false);
    // Real excursions still register, and an unbiased sensor is unaffected either way.
    expect(nowCheck("high-breach").corrected.highBlown).toBe(true);
    expect(nowCheck("low-breach").corrected.lowBlown).toBe(true);
    expect(nowCheck("on-track").corrected).toEqual(nowCheck("on-track").uncorrected);
    // Which frame today's readings are actually in is the dashboard's call, not this
    // helper's -- `app/nowcheck.test.mjs` covers that against the rendered card.
  });
  it("rejects unknown fixture ids", () => {
    expect(() => buildScenario("not-a-scenario")).toThrow("Unknown weather scenario");
  });
});
