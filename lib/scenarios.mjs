// Synthetic inputs only. No filesystem writes, credentials, or provider requests.
// All derived forecasts, scores, and projections use the production functions.
import { scoreAccuracy } from "./accuracy-core.mjs";
import { forecastConsensus, forecastsForDate, hourlyForDate } from "./forecast-core.mjs";
import { buildAlerts } from "./alerts-core.mjs";
import { METRICS, METRIC_LABELS, SOURCE_LABELS, SOURCE_COLORS } from "./constants.mjs";

export const SCENARIOS = [
  { id: "warmer", label: "Local sensor runs warmer", bias: 6, expect: "Adjusted high/low are 6°F above the source forecast; all four temperature lines and scored accuracy charts appear." },
  { id: "cooler", label: "Local sensor runs cooler", bias: -6, expect: "Adjusted high/low are 6°F below the source forecast; cool bias appears in accuracy and tomorrow’s guidance." },
  { id: "on-track", label: "Forecast matches local sensor", bias: 0, expect: "Adjusted and source forecasts agree; mean error is near zero." },
  { id: "residual", label: "Adjustment leaves residual error", bias: 6, wobble: true, expect: "The correction removes the average 6°F bias but not today's 4°F departure from it, so observed sits above the adjusted forecast instead of on top of it." },
  { id: "asymmetric", label: "Warm on highs, accurate on lows", bias: 8, lowBias: 0, expect: "The sensor runs 8°F above the sources at the high and matches them at the low. The hero, the day card and the chart's Forecast* peak all read the same corrected high (+8°F) while the low stays where the sources put it — the curve is fitted per end, not shifted by the pooled 4°F." },
  { id: "sparse-sensor", label: "Sensor too shallow to train a projection", bias: 6, sensorDays: [-1], sensorHours: [2, 17], expect: "The sensor has 15 readings — enough to score a day of bias against, below the 16-sample floor the daily shape needs. The forecast is corrected into the sensor's frame while the projection can only be trained on the pooled sources, so the two must not be spliced into one curve." },
  { id: "pooled-spread", label: "No sensor, sources disagree widely", sensor: false, spread: 14, expect: "Without a sensor the daily shape is trained on NWS and Open-Meteo pooled together, and they sit 14°F apart. The projected high must not inherit that spread as if it were a real daily swing." },
  { id: "high-breach", label: "Actual exceeds forecast high", bias: 6, todayHigh: 104, expect: "Observed high exceeds the forecast; the summary never predicts a high below the high already observed." },
  { id: "low-breach", label: "Actual falls below forecast low", bias: -6, hour: 6, todayLow: 40, expect: "Observed low is below the forecast; the summary never predicts a low above the low already observed." },
  { id: "early-morning", label: "Early morning / limited projection", hour: 4, expect: "A few actual points appear alongside full-day forecasts for today and tomorrow." },
  { id: "after-peak", label: "Evening after the peak", hour: 20, expect: "Observed curve includes the afternoon peak; today and tomorrow forecasts remain visible." },
  { id: "midnight", label: "At local midnight", hour: 0, expect: "Now starts at 12am, yesterday stays on the previous date, and observations do not leak into today." },
  { id: "late-night", label: "Across midnight into tomorrow", hour: 23, expect: "The comparison keeps yesterday, today, and tomorrow on separate dates, with Now at 11pm." },
  { id: "new-sensor", label: "New sensor / no scored history", days: 0, expect: "Today’s actuals appear, but there is no claimed historical adjustment or trained projection." },
  { id: "one-day", label: "Only one scored day", days: 1, expect: "Local adjustment is labeled an early estimate and reports one scored day." },
  { id: "no-sensor", label: "No local sensor", sensor: false, expect: "Source average supplies actuals; the summary does not claim sensor-based adjustment." },
  { id: "empty", label: "Forecast only / no observations", empty: true, expect: "Forecasts remain usable; actual, yesterday, and projection lines are absent." },
  { id: "stale", label: "Sensor stopped yesterday", stale: true, expect: "The sensor reading is labeled old; today’s source observations remain available." },
  { id: "gaps", label: "Missing observations and forecast hours", gaps: true, expect: "Missing hourly values show dashes, and observations have gaps rather than invented measurements." },
  { id: "source-failure", label: "One forecast source unavailable", failed: true, expect: "Open-Meteo alone provides the forecast; NWS is unavailable rather than zero." },
  { id: "disagreement", label: "Sources disagree widely", spread: 14, expect: "Source forecast spread is 14°F and the advice flags disagreement." },
  { id: "storm", label: "Storm, high wind, unhealthy air", storm: true, expect: "Storm, wind, and AQI alerts appear above the three-day temperature comparison." },
  { id: "slow-morning", label: "Cool morning under a hot forecast", hour: 8, todayHigh: 72, expect: "At 8am the sensor is warming as if toward 72° while the adjusted forecast peaks near 84°. Forecast* stays on the forecast all day (peaking near 84°, not bent toward the sensor), the shading shows the morning running cool, and the hero reports the real gap." },
  { id: "heat-wave", label: "Heat wave across the top bands", baseHigh: 101, baseLow: 77, expect: "The comparison's right-hand scale runs Mild → Warm → Hot → Very hot, grid lines sit on 80°, 90°, and 100°, and the band holding the current reading is brightened." },
  { id: "cold-snap", label: "Cold snap through freezing", baseHigh: 41, baseLow: 27, bias: 2, expect: "The right-hand scale runs Freezing → Very cold → Cold with grid lines on 32° and 40°; a band showing fewer than 5° at the plot edge carries no label." },
  { id: "forecast-outage", label: "Forecast service unavailable", outage: true, expect: "Actuals and historical accuracy still render; hourly and daily forecasts report unavailable." },
  { id: "accuracy-outage", label: "Accuracy service unavailable", accuracyOutage: true, expect: "Forecast and actuals remain visible; no historical adjustment or projection is fabricated." },
];

const DAY = 86400000;
const OFFSET = -7 * 3600;
const BASE = Date.parse("2026-09-08T00:00:00Z");
const round = (n) => Math.round(n * 10) / 10;
const dateFor = (d) => new Date(BASE + d * DAY).toISOString().slice(0, 10);
const timestamp = (d, h) => new Date(BASE + d * DAY + h * 3600000 - OFFSET * 1000).toISOString();
const curve = (h, high, low) => round(low + (high - low) * (1 + Math.cos((h - 15) * Math.PI / 12)) / 2);
// A day-to-day departure from the systematic bias, for scenarios that need an
// adjustment to be imperfect. It sums to zero over any six consecutive days, so the
// learned mean bias is untouched and what survives is the part no mean can remove.
// Every other scenario offsets the sensor by a constant, which the mean cancels
// exactly — making the adjusted curve land on the observations to the decimal.
const WOBBLE = [4, -3, 2, -4, 3, -2];
const wobbleFor = (d) => WOBBLE[((d % WOBBLE.length) + WOBBLE.length) % WOBBLE.length];

export function buildScenario(id) {
  const definition = SCENARIOS.find((s) => s.id === id);
  if (!definition) throw new Error(`Unknown weather scenario: ${id}`);
  const cfg = { bias: 6, hour: 12, days: 12, sensor: true, spread: 2, ...definition };
  const nowMs = Date.parse(timestamp(0, cfg.hour + 0.25));
  const location = { id: "scenario", name: "Demo · Hillside neighborhood, California", lat: 37.9, lon: -122.1, ...(cfg.sensor ? { purpleair_sensor_index: "synthetic" } : {}) };
  const sources = ["nws", "open_meteo", ...(cfg.sensor ? ["purpleair"] : [])];
  const history = [], logged = [], omActual = {};
  const results = Object.fromEntries(["nws", "open_meteo"].map((s) => [s, { status: "ok", byDate: {}, byHour: {} }]));
  for (let d = -cfg.days; d <= 1; d++) {
    const trend = d < 0 ? d % 3 : d * 3;
    for (const source of sources) {
      // The sensor's offset is per-end, so a scenario can run warm at the high and
      // accurate at the low — the case a single pooled offset cannot represent.
      const wobble = cfg.wobble ? wobbleFor(d) : 0;
      const highDelta = source === "purpleair" ? cfg.bias + wobble : source === "nws" ? -cfg.spread / 2 : cfg.spread / 2;
      const lowDelta = source === "purpleair" ? (cfg.lowBias ?? cfg.bias) + wobble : highDelta;
      const high = (cfg.baseHigh ?? 78) + trend + highDelta, low = (cfg.baseLow ?? 58) + trend + lowDelta;
      if (source !== "purpleair") {
        const day = { high_f: high, low_f: low, conditions: cfg.storm ? "Thunderstorms" : "Mostly Sunny", precip_prob: cfg.storm ? 85 : 10, precip_in: cfg.storm ? 0.7 : 0 };
        results[source].byDate[dateFor(d)] = day;
        results[source].byHour[dateFor(d)] = {};
        for (let h = 0; h < 24; h++) {
          if (cfg.gaps && d === 0 && [14, 15, 16].includes(h)) continue;
          results[source].byHour[dateFor(d)][h] = {
            temp_f: curve(h, high, low), conditions: cfg.storm ? "Thunderstorms" : h < 6 || h >= 18 ? "Clear" : "Sunny",
            is_day: h >= 6 && h < 18, precip_prob: cfg.storm ? 85 : 10, precip_in: cfg.storm ? 0.05 : 0,
            wind_mph: cfg.storm ? 35 : 8, gust_mph: cfg.storm ? 48 : 12,
          };
        }
        logged.push({ loc_id: location.id, source, target_date: dateFor(d), made_at: timestamp(d - 1, 12), high_f: high, low_f: low });
        if (source === "open_meteo" && d < 0) omActual[dateFor(d)] = { high_f: high, low_f: low };
      }
      if (cfg.empty || d > 0 || (cfg.stale && source === "purpleair" && d === 0)) continue;
      // A sensor can report on only some days, over only part of the day — which is how
      // it ends up scoreable for bias but too thin to train the daily shape on.
      if (source === "purpleair" && cfg.sensorDays && !cfg.sensorDays.includes(d)) continue;
      const [fromHour, toHour] = source === "purpleair" && cfg.sensorHours ? cfg.sensorHours : [0, 24];
      for (let h = fromHour; h < toHour && (d < 0 || h <= cfg.hour); h++) {
        if (cfg.gaps && d === 0 && [7, 8, 9, 10].includes(h)) continue;
        history.push({
          ts: timestamp(d, h), source, loc_id: location.id, status: "ok",
          temp_f: curve(h, source === "purpleair" && d === 0 ? cfg.todayHigh ?? high : high, source === "purpleair" && d === 0 ? cfg.todayLow ?? low : low),
          humidity: 55, wind_mph: source === "purpleair" ? null : cfg.storm ? 35 : 8,
          pressure_inhg: 29.92, pm25: cfg.storm ? 65 : 8, aqi: cfg.storm ? 160 : 35,
          conditions: cfg.storm ? "Thunderstorms" : "Clear", place: `Synthetic ${SOURCE_LABELS[source]}`,
          lat: location.lat, lon: location.lon, distance_mi: source === "purpleair" ? 0.1 : 4, source_url: null,
        });
      }
    }
  }
  history.sort((a, b) => a.ts.localeCompare(b.ts));
  if (cfg.failed) results.nws = { status: "error", error: "Synthetic provider outage" };
  const forecasts = forecastsForDate(results, dateFor(0));
  const consensus = forecastConsensus(forecasts);
  const hourly = hourlyForDate(results, dateFor(0));
  hourly.hours.forEach((h) => { h.aqi = cfg.storm ? 160 : 35; });
  const tomorrowForecasts = forecastsForDate(results, dateFor(1));
  const accuracy = scoreAccuracy(location, { readings: history, forecasts: cfg.empty ? [] : logged, omActual: cfg.empty ? {} : omActual, nowMs, offsetSec: OFFSET });
  const latest = Object.fromEntries(history.map((r) => [r.source, r]));
  const outliers = Object.fromEntries(sources.map((s) => [s, 0]));
  let comparisons = 0;
  const snapshots = new Map();
  for (const r of history) {
    if (!snapshots.has(r.ts)) snapshots.set(r.ts, []);
    snapshots.get(r.ts).push(r);
  }
  for (const rows of snapshots.values()) for (const metric of METRICS) {
    const values = rows.filter((r) => r[metric] != null).sort((a, b) => a[metric] - b[metric]);
    if (values.length < 3) continue;
    const median = values[Math.floor(values.length / 2)][metric];
    const farthest = [...values].sort((a, b) => Math.abs(b[metric] - median) - Math.abs(a[metric] - median))[0];
    if (farthest[metric] !== median) outliers[farthest.source]++;
    comparisons++;
  }
  return {
    ...definition, nowMs,
    data: { location, locations: [location], activeLocationId: location.id, keys: { purpleair: cfg.sensor }, generated: new Date(nowMs).toISOString(), totalReadings: history.length,
      sources, sourceLabels: SOURCE_LABELS, sourceColors: SOURCE_COLORS, metrics: METRICS, metricLabels: METRIC_LABELS,
      history, latest, outliers, comparisons, sourceStatus: Object.fromEntries(sources.map((s) => [s, true])) },
    forecast: cfg.outage ? null : { location, date: dateFor(0), utc_offset_seconds: OFFSET, sources: ["nws", "open_meteo"], sourceLabels: SOURCE_LABELS, sourceColors: SOURCE_COLORS,
      forecasts, consensus, hourly, hourlyTomorrow: hourlyForDate(results, dateFor(1)),
      tomorrow: { date: dateFor(1), forecasts: tomorrowForecasts, consensus: forecastConsensus(tomorrowForecasts) },
      alerts: buildAlerts({ consensus, forecasts, hours: hourly.hours, aqiToday: { max: cfg.storm ? 160 : 35, maxHour: 12 } }) },
    accuracy: cfg.accuracyOutage ? null : accuracy,
  };
}
