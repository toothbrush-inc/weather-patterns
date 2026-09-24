export type AdjustmentDay = {
  date: string; paHigh: number | null; paLow: number | null;
  actualHigh: number | null; actualLow: number | null;
  sources: Record<string, { forecastHigh: number | null; forecastLow: number | null }>;
};
export type AdjustmentAccuracy = { hasPurpleair: boolean; daily: AdjustmentDay[] };
export function consensusBiasFor(accuracy: AdjustmentAccuracy, metric: "high" | "low" | "mean", before?: string) {
  const errors: number[] = [];
  let days = 0;
  for (const day of accuracy.daily) {
    if (before && day.date >= before) continue;
    let scored = false;
    for (const end of metric === "mean" ? (["high", "low"] as const) : [metric]) {
      const actual = accuracy.hasPurpleair ? (end === "high" ? day.paHigh : day.paLow) : (end === "high" ? day.actualHigh : day.actualLow);
      const values = Object.values(day.sources).map(s => end === "high" ? s.forecastHigh : s.forecastLow).filter((v): v is number => v != null);
      if (actual == null || !values.length) continue;
      errors.push(values.reduce((a, b) => a + b, 0) / values.length - actual);
      scored = true;
    }
    if (scored) days++;
  }
  return errors.length ? { bias: errors.reduce((a, b) => a + b, 0) / errors.length, mae: Math.round(errors.reduce((a, b) => a + Math.abs(b), 0) / errors.length * 10) / 10, n: days } : null;
}
export type Bias = ReturnType<typeof consensusBiasFor>;
// A bias under 2° is inside the noise of a daily high/low score, so it is not applied.
function shiftFor(bias: Bias) {
  return !bias || Math.abs(bias.bias) < 2 ? 0 : bias.bias;
}
export function adjustedValue(value: number | null, bias: Bias) {
  return value == null || !bias ? null : Math.round(value - shiftFor(bias));
}
// The chart's forecast curve carries the same daily high and low as the hero and the
// day cards: the hourly consensus is mapped linearly so its warmest hour lands on the
// corrected high and its coldest on the corrected low (adjustedDailyRange). With only
// one end known the curve shifts to meet that end. This supersedes the flat pooled
// shift used until 2026-09-15 — a pooled +2.4° fell inside the dead-band while the
// high-only bias did not, so the graph peaked at 79° under a hero reading "High 83°".
// The data still says nothing about 9am; what must hold by construction is that the
// peak on the graph is the High above it. It also absorbs the half-degree by which an
// hourly consensus peak sits under the daily-high consensus.
export function fitCurve(values: (number | null)[], range: DailyRange | null | undefined) {
  const finite = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (!range || !finite.length) return values.map(() => null);
  const lo = Math.min(...finite), hi = Math.max(...finite);
  const { high, low } = range;
  const map = high != null && low != null && hi > lo && high > low ? (v: number) => low + (v - lo) * (high - low) / (hi - lo)
    : high != null ? (v: number) => v + (high - hi)
    : low != null ? (v: number) => v + (low - lo)
    : null;
  if (!map) return values.map(() => null);
  return values.map(v => v == null ? null : Math.round(map(v) * 10) / 10);
}
// ---------------------------------------------- Today's reality check ------
// °F of slack before today's observations are called an outright forecast miss.
export const NOWCHECK_TOL = 1;

// Which set of thermometers a temperature came off. A local sensor can sit degrees
// away from the sources it is scored against, so two temperatures are only
// comparable once they are in the same frame.
export type ObsFrame = "sensor" | "sources";

// The forecast bounds restated in the frame today's observations arrived in, so that a
// breach means the weather missed rather than that the sensor reads differently than
// the sources. Uncorrected, a sensor running 6° warm is "past the forecast high" every
// afternoon — while the advice card, applying this same per-end bias, calls the very
// same day on track.
//
// Corrected per end rather than by one pooled offset: a source can run warm on highs
// and true on lows, and a breach at one end must not be judged by the other end's miss.
//
// The correction applies only when the bias was learned in the frame the observation
// came from. `consensusBiasFor` scores against the sensor when one exists and against
// the sources' own observations otherwise; the caller picks the observation frame
// independently. A sensor with history that went quiet today yields a source-frame
// reading, and applying a sensor-frame bias to it would invent the error this removes.
export function comparableBounds(high: number | null, low: number | null, accuracy: AdjustmentAccuracy | null, frame: ObsFrame) {
  const matched = accuracy != null && accuracy.hasPurpleair === (frame === "sensor");
  const cHigh = matched ? adjustedValue(high, consensusBiasFor(accuracy, "high")) : null;
  const cLow = matched ? adjustedValue(low, consensusBiasFor(accuracy, "low")) : null;
  return { high: cHigh ?? high, low: cLow ?? low, corrected: (cHigh ?? high) !== high || (cLow ?? low) !== low };
}

// You can only be CERTAIN a forecast is wrong once reality has already passed a bound,
// which is why this asserts nothing about where the day is headed.
export function breachAt(bounds: { high: number | null; low: number | null }, highSoFar: number | null, lowSoFar: number | null) {
  return {
    highBlown: bounds.high != null && highSoFar != null && highSoFar > bounds.high + NOWCHECK_TOL,
    lowBlown: bounds.low != null && lowSoFar != null && lowSoFar < bounds.low - NOWCHECK_TOL,
  };
}

export function highComparison(value: number | null, reference: number | null) {
  if (value == null || reference == null) return "Not enough data";
  const delta = Math.round(value - reference);
  return delta === 0 ? "About the same" : `${Math.abs(delta)}° ${delta > 0 ? "hotter" : "colder"}`;
}
// "The next few hours" runs past midnight, so callers pass today's hourly values
// followed by tomorrow's and index into the pair. A move under 2°F is the same
// noise floor the daily comparisons use, and reads as no trend at all.
export const TREND_HOURS = 3;
export function temperatureTrend(hours: (number | null)[], from: number, ahead = TREND_HOURS) {
  const current = hours[from] ?? null, later = hours[from + ahead] ?? null;
  if (current == null || later == null) return null;
  const delta = Math.round(later - current);
  const phrase = Math.abs(delta) < 2 ? "Holding steady" : delta > 0 ? "Warming up" : "Cooling off";
  return { phrase, delta, hour: (from + ahead) % 24 };
}
// Describes the correction behind the chart's "Forecast*" so the asterisk can name
// real numbers. Reports the SHIFT applied, not the raw bias: a consensus running
// 6° warm is described as "6° cooler", the direction the reader sees on the curve.
// Describes the correction behind the chart's "Forecast*" so the asterisk can name
// real numbers. Reports the SHIFT applied, not the raw bias: a consensus running
// 6° warm is described as "6° cooler", the direction the reader sees on the curve.
export function adjustmentSummary(bias: Bias) {
  if (!bias) return null;
  return { n: bias.n, shift: Math.abs(bias.bias) < 2 ? null : `${Math.abs(Math.round(bias.bias))}° ${bias.bias > 0 ? "cooler" : "warmer"}` };
}
// The chart's Forecast* line: the fitted (bias-adjusted) source curve, falling back
// to the raw source hour by hour where no adjustment exists — a thin history empties
// `adjusted`, and without the fallback the curve would simply vanish. It is the forecast all day —
// the local diurnal projection is deliberately NOT spliced or blended in (it was,
// until 2026-09-15): a curve bent toward today's own observations erases the
// observed-vs-forecast shading and makes the hero's "cooler than expected" measure
// the day against itself. The projection's home is the hero's outlook copy instead.
export function forecastCurve(source: (number | null)[], adjusted: (number | null)[]) {
  return source.map((v, h) => adjusted[h] ?? v);
}

// The hero's "3° warmer than expected": the current reading against the chart's
// own forecast curve for this minute — forecastCurve(), so the hero and the chart's
// tooltip name the same expectation — interpolated between the two hours around
// now. Anything under NOW_DELTA_MIN rounds to nothing worth saying.
export const NOW_DELTA_MIN = 1;
export function nowVsExpected(current: number | null, curve: (number | null)[], hour: number, minute: number) {
  const a = curve[hour] ?? null;
  if (current == null || a == null) return null;
  const b = curve[hour + 1] ?? a;
  const delta = Math.round(current - (a + (b - a) * (minute / 60)));
  if (Math.abs(delta) < NOW_DELTA_MIN) return null;
  return { delta: Math.abs(delta), warmer: delta > 0 };
}

// One daily range for the hero's High/Low and the day cards, so they cannot
// disagree: the consensus high and low each shifted by their OWN error (the high by
// how highs have missed here, the low by how lows have) — unlike the hourly curve,
// which takes one pooled shift. A day already underway is bounded by what has been
// observed: the expected high cannot sit below a high already recorded. Falls back
// to the raw consensus where nothing has been scored yet.
export type DailyRange = { high: number | null; low: number | null };
export function adjustedDailyRange(consensus: { high_f: number | null; low_f: number | null } | null | undefined, accuracy: AdjustmentAccuracy | null, observed?: { high: number | null; low: number | null } | null): DailyRange | null {
  if (!consensus) return null;
  const shift = (value: number | null, metric: "high" | "low") => (accuracy ? adjustedValue(value, consensusBiasFor(accuracy, metric)) : null) ?? value;
  let high = shift(consensus.high_f, "high"), low = shift(consensus.low_f, "low");
  if (observed?.high != null) high = high == null ? observed.high : Math.max(high, observed.high);
  if (observed?.low != null) low = low == null ? observed.low : Math.min(low, observed.low);
  return high == null && low == null ? null : { high, low };
}
