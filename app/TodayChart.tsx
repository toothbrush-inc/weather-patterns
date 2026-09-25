"use client";

import { useState } from "react";
import { ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ReferenceLine, ReferenceArea, CartesianGrid, ResponsiveContainer } from "recharts";
import { temperatureTimeline, timelineX, withLatestReading, interpolateHour, type LatestReading, type TimelinePoint } from "../lib/temperature-timeline";
import { fitCurve, adjustedValue, adjustmentSummary, forecastCurve, consensusBiasFor, highComparison, temperatureTrend, TREND_HOURS, type AdjustmentAccuracy, type DailyRange } from "../lib/forecast-adjustment";
import { temperatureDomain } from "../lib/temperature-domain";
import { temperatureBands } from "../lib/temperature-bands";
import { bandFor, domainShowingBand, temperatureTicks, visibleBands } from "../lib/temperature-scale";
import { useWeatherNow } from "./WeatherClock";

type Hour = { hour: number; temp_f: number | null; precip_prob: number | null; wind_mph: number | null };
type Day = { date: string; hours: Hour[] } | null;
type Props = {
  history: { ts: string; status: string; source: string; temp_f: number | null }[];
  accuracy?: (AdjustmentAccuracy & { todayLocal: string; diurnal: { source: string } | null }) | null;
  currentTemp?: number | null;
  hourly?: Day; tomorrow?: Day; date?: string | null; utcOffsetSeconds?: number | null; loading?: boolean;
  // Bias-adjusted daily high/low for the day cards (see Dashboard's dailyRanges);
  // a card falls back to its hourly values where a daily forecast is missing.
  ranges?: { today: DailyRange | null; tomorrow: DailyRange | null } | null;
  // The corrected forecast high/low the curves are fitted to (today's NOT bounded by
  // observations, unlike the card's), so the graph's peak is the hero's High.
  forecastRanges?: { today: DailyRange | null; tomorrow: DailyRange | null } | null;
};
const colors = { yesterday: "#94a3b8", actual: "#60d5f7", forecast: "#60d5f7", tomorrow: "#fbbf24" };
const hourLabel = (h: number) => `${h % 12 || 12}${h >= 12 ? "pm" : "am"}`;
const clockLabel = (hour: number) => { const h = Math.floor(hour), m = Math.round((hour - h) * 60); return `${h % 12 || 12}:${String(m).padStart(2, "0")}${h >= 12 ? "pm" : "am"}`; };
const temperature = (v: number | null) => v == null ? "—" : `${Math.round(v * 10) / 10}°F`;


export default function TodayChart({ history, hourly, tomorrow, date, utcOffsetSeconds, loading, accuracy, currentTemp, ranges, forecastRanges }: Props) {
  const now = useWeatherNow();
  const [sourceOverride, setSourceOverride] = useState<boolean | null>(null);
  const offset = (utcOffsetSeconds ?? -new Date(now).getTimezoneOffset() * 60) * 1000;
  const localNow = new Date(now + offset);
  const today = date ?? localNow.toISOString().slice(0, 10);
  const shiftDate = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  const localAccuracy = accuracy?.todayLocal === today ? accuracy : null;
  // Hourly means for a day, plus that day's latest observation at its true minute.
  const observed = (day: string) => {
    const snapshots = new Map<string, { hour: number; values: number[] }>();
    for (const r of history) {
      if (localAccuracy?.hasPurpleair && r.source !== "purpleair") continue;
      if (r.status !== "ok" || r.temp_f == null || !Number.isFinite(r.temp_f) || !Number.isFinite(Date.parse(r.ts)) || Date.parse(r.ts) > now) continue;
      const local = new Date(Date.parse(r.ts) + offset);
      if (local.toISOString().slice(0, 10) !== day) continue;
      const cell = snapshots.get(r.ts) ?? { hour: local.getUTCHours(), values: [] };
      cell.values.push(r.temp_f); snapshots.set(r.ts, cell);
    }
    const buckets: number[][] = Array.from({ length: 24 }, () => []);
    for (const { hour, values } of snapshots.values()) buckets[hour].push(values.reduce((a, b) => a + b, 0) / values.length);
    const last = [...snapshots.keys()].sort().at(-1);
    const latest: LatestReading | null = last ? (() => {
      const local = new Date(Date.parse(last) + offset), values = snapshots.get(last)!.values;
      return { hour: local.getUTCHours() + local.getUTCMinutes() / 60, temp: Math.round(values.reduce((a, b) => a + b, 0) / values.length * 10) / 10 };
    })() : null;
    return { hourly: buckets.map(v => v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : null), latest };
  };
  const yesterday = observed(shiftDate(-1)).hourly, todayObserved = observed(today), actual = todayObserved.hourly;
  const todayHours = new Map((hourly?.date === today ? hourly.hours : []).map(h => [h.hour, h]));
  const tomorrowHours = new Map((tomorrow?.date === shiftDate(1) ? tomorrow.hours : []).map(h => [h.hour, h]));
  const forecastValues = Array.from({ length: 24 }, (_, h) => todayHours.get(h)?.temp_f ?? null);
  const tomorrowValues = Array.from({ length: 24 }, (_, h) => tomorrowHours.get(h)?.temp_f ?? null);
  // Each day's curve is fitted to its corrected daily high/low (see fitCurve) — the
  // per-end corrections the hero and day cards already show. The star and the
  // source-forecast toggle appear only when one of those ends was actually corrected.
  const highBias = localAccuracy ? consensusBiasFor(localAccuracy, "high") : null;
  const lowBias = localAccuracy ? consensusBiasFor(localAccuracy, "low") : null;
  const highSummary = adjustmentSummary(highBias), lowSummary = adjustmentSummary(lowBias);
  const adjustedToday = fitCurve(forecastValues, forecastRanges?.today);
  const adjustedTomorrow = fitCurve(tomorrowValues, forecastRanges?.tomorrow);
  const yDay = localAccuracy?.daily.find(d => d.date === shiftDate(-1));
  const yMean = (metric: "forecastHigh" | "forecastLow") => {
    const values = Object.values(yDay?.sources ?? {}).map(s => s[metric]).filter((v): v is number => v != null);
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  };
  // Reconstruct from only older scored days, never yesterday's own outcome.
  const yBias = localAccuracy ? consensusBiasFor(localAccuracy, "mean", shiftDate(-1)) : null;
  const yHigh = adjustedValue(yMean("forecastHigh"), yBias), yLow = adjustedValue(yMean("forecastLow"), yBias);
  // One forecast curve per day: the adjusted source, all day (see forecastCurve).
  const todayForecast = forecastCurve(forecastValues, adjustedToday);
  const tomorrowForecast = forecastCurve(tomorrowValues, adjustedTomorrow);
  const sourceRows = temperatureTimeline([], [], forecastValues, tomorrowValues);
  const isToday = localNow.toISOString().slice(0, 10) === today;
  // Today's latest reading is one more point at its true minute, so the observed
  // line (and the shading under it) runs all the way to the marker instead of
  // stopping at the top of the hour. The forecasts there are interpolated.
  const latest = isToday ? todayObserved.latest : null;
  const rows = withLatestReading(
    temperatureTimeline(yesterday, actual, todayForecast, tomorrowForecast).map((r, i) => ({ ...r, sourceForecast: sourceRows[i].forecast, sourceTomorrow: sourceRows[i].tomorrow })),
    latest, h => ({ forecast: interpolateHour(todayForecast, h), sourceForecast: interpolateHour(forecastValues, h) }));
  const bands = temperatureBands(rows);
  // The current reading's band must stay labelled, so the plot grows to show at
  // least a few degrees of it when the reading sits near the top or bottom edge.
  const yDomain = domainShowingBand(temperatureDomain(rows.flatMap(r => [r.yesterday, r.actual, r.forecast, r.tomorrow, r.sourceForecast, r.sourceTomorrow])), isToday ? currentTemp : null);
  const hasData = rows.some(r => [r.yesterday, r.actual, r.forecast, r.tomorrow].some(v => v != null));
  const daily = [
    { key: "yesterday" as const, label: "Yesterday", date: shiftDate(-1), values: yesterday, range: null as DailyRange | null },
    { key: "today" as const, label: "Today", date: today, values: actual.map((v, h) => v ?? todayForecast[h]), range: ranges?.today ?? null },
    { key: "tomorrow" as const, label: "Tomorrow", date: shiftDate(1), values: tomorrowForecast, range: ranges?.tomorrow ?? null },
  ];
  const maximum = (values: (number | null)[]) => {
    const available = values.filter((v): v is number => v != null);
    return available.length ? Math.max(...available) : null;
  };
  const minimum = (values: (number | null)[]) => {
    const available = values.filter((v): v is number => v != null);
    return available.length ? Math.min(...available) : null;
  };
  // Card extremes: the adjusted daily forecast where there is one, else the hourly values.
  const cardLow = (d: typeof daily[number]) => d.range?.low ?? minimum(d.values);
  const cardHigh = (d: typeof daily[number]) => d.range?.high ?? maximum(d.values);
  const highs = daily.map(cardHigh);
  // Plain-language scale: band edges are the grid lines, band names run down the
  // right edge, and the band the current reading sits in is picked out.
  const scale = visibleBands(yDomain);
  const currentBand = isToday && currentTemp != null && Number.isFinite(currentTemp) ? bandFor(currentTemp) : null;
  const bandTick = ({ x, y, payload }: { x?: number; y?: number; payload?: { value: number } }) => {
    const band = scale.find(b => b.mid === payload?.value);
    if (!band) return <g />;
    const current = currentBand?.floor === band.floor;
    return <text x={x} y={y} dy={4} textAnchor="start" fill={current ? "#e6edf3" : "#64748b"} fontSize={11} fontWeight={current ? 600 : 400}>{band.label}</text>;
  };
  // A trend is a delta, so both ends must come off one series. Today's card mixes
  // observations with forecasts, and where no adjustment reconciles the two scales
  // that step is source bias, not weather — so the trend reads forecasts only,
  // continued into tomorrow's so a late-evening trend can cross midnight.
  const trend = isToday ? temperatureTrend([...todayForecast, ...tomorrowForecast], localNow.getUTCHours()) : null;
  const trendDetail = trend && (Math.abs(trend.delta) < 2
    ? `Within 2° through ${hourLabel(trend.hour)}`
    : `${Math.abs(trend.delta)}° ${trend.delta > 0 ? "warmer" : "cooler"} by ${hourLabel(trend.hour)}`);
  const deltas = [highs[0] != null && highs[1] != null ? Math.round(highs[0] - highs[1]) : null, highs[0] != null && highs[1] != null ? Math.round(highs[1] - highs[0]) : null, highs[2] != null && highs[1] != null ? Math.round(highs[2] - highs[1]) : null];
  const direction = (delta: number | null) => delta == null ? "unknown" : delta > 0 ? "warm" : delta < 0 ? "cool" : "steady";
  const arrow = (delta: number | null) => delta == null ? "—" : delta > 0 ? "↗" : delta < 0 ? "↘" : "→";
  const summaries = [highComparison(highs[0], highs[1]), highComparison(highs[1], highs[0]), highComparison(highs[2], highs[1])];
  const hasAdjustment = Boolean(highSummary?.shift || lowSummary?.shift);
  const scoredDays = highBias?.n ?? lowBias?.n ?? 0;
  const endNote = (s: ReturnType<typeof adjustmentSummary>) => s?.shift ? `${s.shift} than the source consensus` : "as the sources forecast it";
  // Default the comparison on wherever a correction was applied: with it hidden, a
  // well-adjusted forecast is indistinguishable from a forecast that never needed
  // adjusting, because both sit on top of the observations. An explicit choice sticks.
  const showSource = sourceOverride ?? hasAdjustment;
  const star = hasAdjustment ? "*" : "";
  const pointLabel = (r: TimelinePoint) => r.latest && latest ? `Today · ${clockLabel(latest.hour)} · latest reading` : `${daily[r.day].label} · ${hourLabel(r.startHour)}${r.day === 1 ? "" : `–${hourLabel(r.endHour + 1 === 24 ? 0 : r.endHour + 1)}`}`;
  const readout = (r: typeof rows[number]) => <>
    <div className="acc-tip-head">{pointLabel(r)}</div>
    {(r.day === 1 ? [["Observed", r.actual], [`Forecast${star}`, r.forecast], ...(showSource ? [["Source forecast", r.sourceForecast]] : [])]
      : r.day === 0 ? [["Observed average", r.yesterday], [`Forecast${star} high`, yHigh], [`Forecast${star} low`, yLow]]
      : [[`Forecast${star} average`, r.tomorrow], ...(showSource ? [["Source forecast average", r.sourceTomorrow]] : [])]
    ).map(([label, value]) => <div className="acc-tip-row" key={String(label)}><span>{label}</span><strong>{temperature(value as number | null)}</strong></div>)}
    <div className="tc-tip-extras">{r.latest ? "Forecast interpolated to this minute" : r.day === 1 ? "Hourly detail" : `${r.samples}/3 hourly values available in this interval`}</div>
  </>;
  return <section className="today-chart" aria-label="Three-day temperature comparison">
    {hasData ? <ResponsiveContainer width="100%" height={278}>
      <ComposedChart accessibilityLayer data={rows} margin={{ top: 4, right: 0, left: 0, bottom: 8 }}>
        <ReferenceArea x1={12} x2={60} fill={colors.actual} fillOpacity={0.045} />
        {/* The current reading's band, shaded across today only, so the label and the plot agree on where "now" sits. */}
        {currentBand && <ReferenceArea x1={12} x2={60} y1={Math.max(currentBand.floor, yDomain[0])} y2={Math.min(currentBand.ceiling, yDomain[1])} fill="#e6edf3" fillOpacity={0.07} ifOverflow="hidden" />}
        <ReferenceLine x={12} stroke="#536171" />
        <ReferenceLine x={60} stroke="#536171" />
        <CartesianGrid vertical={false} stroke="#2d3742" strokeDasharray="3 5" />
        <XAxis dataKey="x" type="number" domain={[0, 72]} ticks={[6, 12, 24, 36, 48, 60, 66]} tickFormatter={v => hourLabel(v < 12 ? v * 2 : v < 60 ? (v - 12) / 2 : (v - 60) * 2)} tick={{ fill: "#94a3b8", fontSize: 11 }} minTickGap={16} />
        <XAxis xAxisId="days" dataKey="x" type="number" domain={[0, 72]} ticks={[6, 36, 66]} orientation="top" height={18} axisLine={false} tickLine={false} tickFormatter={v => daily[v < 12 ? 0 : v < 60 ? 1 : 2].label} tick={{ fill: "#cbd5e1", fontSize: 10 }} />
        <YAxis width={44} domain={yDomain} ticks={temperatureTicks(yDomain)} allowDataOverflow includeHidden tickFormatter={v => `${Math.round(v)}°`} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis yAxisId="bands" orientation="right" width={62} domain={yDomain} ticks={scale.map(b => b.mid)} interval={0} allowDataOverflow tick={bandTick} tickMargin={2} axisLine={false} tickLine={false} />
        <Tooltip content={({ active, label }) => active && rows.find(r => r.x === Number(label)) ? <div className="acc-tip">{readout(rows.find(r => r.x === Number(label))!)}</div> : null} />
        <Area data={bands} dataKey="warm" type="linear" fill="#f87171" fillOpacity={0.3} stroke="none" legendType="none" tooltipType="none" connectNulls={false} isAnimationActive={false} />
        <Area data={bands} dataKey="cool" type="linear" fill="#60a5fa" fillOpacity={0.3} stroke="none" legendType="none" tooltipType="none" connectNulls={false} isAnimationActive={false} />
        {showSource && ([["sourceForecast", colors.forecast], ["sourceTomorrow", colors.tomorrow]] as const).map(([key, stroke]) => <Line key={key} dataKey={key} name="Source forecast" type="linear" stroke={stroke} strokeOpacity={0.55} strokeWidth={1.5} strokeDasharray="1 4" dot={false} connectNulls={false} isAnimationActive={false} />)}
        {(["yesterday", "forecast", "actual", "tomorrow"] as const).map(key => <Line key={key} dataKey={key} type="linear" stroke={colors[key]} strokeWidth={key === "actual" ? 3 : 2} strokeDasharray={key === "forecast" ? "7 4" : key === "tomorrow" ? "3 4" : undefined} dot={{ r: 2, strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />)}
        {/* The marker sits at the latest reading's own minute (the hero's clock too), so the observed line ends on it; without a reading today it falls back to the wall clock. */}
        {isToday && <ReferenceLine x={timelineX(1, latest ? latest.hour : localNow.getUTCHours() + localNow.getUTCMinutes() / 60)} stroke="#94a3b8" strokeDasharray="3 4" label={{ value: latest ? `${Math.round(latest.temp)}° · ${clockLabel(latest.hour)}` : "Now", fill: "#94a3b8", fontSize: 11, position: "insideTopRight" }} />}
      </ComposedChart>
    </ResponsiveContainer> : <div className="empty">{loading ? "Loading hourly forecasts…" : "Hourly temperatures are unavailable. The comparison will appear when observations or forecasts arrive."}</div>}
    <div className="tc-days">{daily.map((day, index) => {
      const values = day.values.filter((v): v is number => v != null);
      const lo = cardLow(day), hi = cardHigh(day);
      return <div key={day.key} className="tc-day" style={{ borderTopColor: day.key === "today" ? colors.actual : colors[day.key] }}>
        <span className="tc-day-title">{day.label}<span>{new Date(`${day.date}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}</span></span>
        <strong>{lo != null && hi != null ? `${Math.round(lo)}° – ${Math.round(hi)}°` : loading && day.key !== "yesterday" ? "Loading…" : "No data"}</strong>
        <b className="tc-day-summary" data-trend={direction(deltas[index])}><span className="tc-trend-arrow" aria-hidden="true">{arrow(deltas[index])}</span>{summaries[index]}</b>
        <span>High vs {index === 1 ? "yesterday" : "today"}</span>

        {values.length < 24 && <span className="tc-day-coverage">{values.length}/24 hrs</span>}
      </div>;
    })}</div>
    {trend && <p className="tc-near-trend"><span aria-hidden="true">{arrow(Math.abs(trend.delta) < 2 ? 0 : trend.delta)}</span> {trend.phrase} · {trendDetail}</p>}
    <div className="tc-timeline-legend">
      <span><i className="tc-mark" style={{ borderTopColor: colors.actual }} />Observed</span>
      <span><i className="tc-mark dashed" style={{ borderTopColor: colors.actual }} />Forecast{star} (today)</span>
      <span><i className="tc-mark dashed" style={{ borderTopColor: colors.tomorrow }} />Forecast{star} (tomorrow)</span>
      {showSource && <span><i className="tc-mark dotted" style={{ borderTopColor: colors.forecast, opacity: 0.55 }} />Source forecast</span>}
      {hasAdjustment && <div className="toggle-group tc-legend-toggle">
        <button type="button" className={`toggle${showSource ? " on" : ""}`} aria-pressed={showSource} onClick={() => setSourceOverride(!showSource)}>Source forecast</button>
      </div>}
    </div>
    <div className="tc-band-legend"><span><i className="zone-chip warm" />Warmer than expected</span><span><i className="zone-chip cool" />Cooler than expected</span><small>Shading compares today’s observations with Forecast{star} at the same hour.</small></div>

    <details className="tc-methodology"><summary>How to read this comparison</summary>{hasAdjustment && <p className="tc-star-note">* Adjusted for this location: the forecast curve is fitted so its daily high reads {endNote(highSummary)} and its low {endNote(lowSummary)} — the mean errors against your observations over {scoredDays} scored {scoredDays === 1 ? "day" : "days"}.</p>}<p className="tc-foot">{localAccuracy?.hasPurpleair ? "Observations use your local sensor. " : "Observations average reporting sources. "}Yesterday’s forecast high and low (in the tooltip) are reconstructed from logged daily high/low and errors on earlier days; no hourly forecast was saved. {yHigh == null || yLow == null ? "Yesterday’s adjustment is unavailable. " : ""}{hasAdjustment ? "Forecast* carries those corrections across the whole day, so its high and low are the forecast high and low shown above; today’s hours still to come are not bent toward what has been observed so far, so the shading keeps showing where the day departs from the forecast. "
      : scoredDays ? `No correction is needed here: over ${scoredDays} scored ${scoredDays === 1 ? "day" : "days"} the source consensus has averaged within 2°F of your observations at both ends of the day, so the forecast is shown unmodified. `
      : "No adjustment yet — the forecast shown is the raw source consensus, and it gains a * once enough days are scored. "}Today’s and tomorrow’s cards show the daily forecast high and low, each adjusted by its own error against your observations — the high by how highs have missed here, the low by how lows have — with today’s bounded by what has already been recorded; yesterday’s card is what was observed. Where a daily forecast is missing, a card falls back to its hourly values. Daily summaries compare those highs. Today’s trend compares the forecast for the current hour with {TREND_HOURS} hours later — forecast against forecast, so a source running warm or cool cannot masquerade as a trend — continuing into tomorrow after 9pm. Solid lines are observations; dashed lines are forecasts. The grid lines fall on the edges of the plain-language temperature bands named down the right side (Mild is 70–79°, Warm 80–89°, and so on); the band holding the current reading is brightened and shaded across today. Outer-day points average available values in each 3-hour interval; empty intervals remain gaps.</p></details>
  </section>;
}
