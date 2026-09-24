"use client";

import { useState } from "react";
import {
  LineChart, Line, ErrorBar, BarChart, Bar, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine, ReferenceArea, Cell,
} from "recharts";

type DaySource = {
  forecastHigh: number | null;
  forecastLow: number | null;
  ownHigh: number | null; ownLow: number | null;
  highErrOwn: number | null; lowErrOwn: number | null;
  highErrPa: number | null; lowErrPa: number | null;
};
type Daily = {
  date: string;
  actualHigh: number | null;
  actualLow: number | null;
  paHigh: number | null;
  paLow: number | null;
  sources: Record<string, DaySource>;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDate(d: string) {
  const [, m, day] = d.split("-");
  return `${MONTHS[Number(m) - 1]} ${Number(day)}`;
}

// Within ±GOOD_BAND°F a forecast is "on target" (neutral corridor); beyond it the
// error is tinted by direction — warm above, cool below — the chart's whole story.
const GOOD_BAND = 3;
const WARM = "#f87171"; // ran hot
const COOL = "#60a5fa"; // ran cold
const ZERO = "#56657a";

const tickStyle = { fill: "#8b98a5", fontSize: 11 };
const tooltipStyle = { background: "#1a2129", border: "1px solid #2d3742", borderRadius: 8, color: "#e6edf3" };
const ACTUAL_COLOR = "#e6edf3";
const CONSENSUS_COLOR = "#fbbf24"; // gold — distinct from every source line

function round1(x: number) { return Math.round(x * 10) / 10; }
function signed(v: number) { return `${v > 0 ? "+" : ""}${round1(v)}`; }
// Quality of a typical-miss number, mirroring the temp spread thresholds elsewhere.
function quality(mae: number) { return mae <= 2 ? "good" : mae <= 5 ? "mid" : "bad"; }
function biasWord(b: number) { return b > 0.5 ? "runs warm" : b < -0.5 ? "runs cool" : "balanced"; }
// Typical miss (MAE) + lean (signed bias) over a list of signed errors.
function statOf(errs: number[]) {
  if (!errs.length) return null;
  return {
    mae: round1(errs.reduce((a, e) => a + Math.abs(e), 0) / errs.length),
    bias: round1(errs.reduce((a, e) => a + e, 0) / errs.length),
    n: errs.length,
  };
}

// Least-squares fit so the "does it miss more on hot/cold days?" slope is drawn,
// not just asserted. Needs ≥3 points to mean anything.
function regression(pts: { x: number; y: number }[]) {
  const n = pts.length;
  if (n < 3) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-9) return null;
  const slope = (n * sxy - sx * sy) / denom;
  return { slope, intercept: (sy - slope * sx) / n };
}

function ToggleGroup<T extends string>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="toggle-group">
      {options.map(([v, label]) => (
        <button key={v} className={`toggle${v === value ? " on" : ""}`} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  );
}

export default function AccuracyCharts({
  daily, sources, sourceLabels, sourceColors, hasPurpleair,
}: {
  daily: Daily[];
  sources: string[];
  sourceLabels: Record<string, string>;
  sourceColors: Record<string, string>;
  hasPurpleair: boolean;
}) {
  const [metric, setMetric] = useState<"high" | "low">("high");
  const [shown, setShown] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(sources.map((s) => [s, true])),
  );
  const [showConsensus, setShowConsensus] = useState(true);
  if (!daily.length) return null;
  const visibleSources = sources.filter((s) => shown[s] !== false);

  // One error definition for both charts: forecast − the local "actual" (your
  // PurpleAir sensor if present, else the cross-source consensus). Positive = the
  // forecast ran warm, negative = it ran cool.
  const actualLabel = hasPurpleair ? "PurpleAir" : "consensus";
  const actualOf = (d: Daily) =>
    metric === "high"
      ? (hasPurpleair ? d.paHigh : d.actualHigh)
      : (hasPurpleair ? d.paLow : d.actualLow);
  const fcOf = (d: Daily, s: string) =>
    metric === "high" ? d.sources[s]?.forecastHigh ?? null : d.sources[s]?.forecastLow ?? null;
  const ownOf = (d: Daily, s: string) =>
    metric === "high" ? d.sources[s]?.ownHigh ?? null : d.sources[s]?.ownLow ?? null;

  // Consensus forecast = the mean of the forecast-capable sources — one clean reference
  // line to read against the white actual. Computed over all sources (not the show/hide
  // toggles) so it stays a stable "what the group expected." Only meaningful with ≥2.
  const hasConsensus = sources.length >= 2;
  const consensusOf = (d: Daily) => {
    const fcs = sources.map((s) => fcOf(d, s)).filter((v): v is number => v != null);
    return fcs.length ? round1(fcs.reduce((a, b) => a + b, 0) / fcs.length) : null;
  };

  const showCons = hasConsensus && showConsensus;
  const labelOf = (key: string) => (key === "consensus" ? "Consensus" : sourceLabels[key] || key);
  const colorOf = (key: string) => (key === "consensus" ? CONSENSUS_COLOR : sourceColors[key]);

  // One row per day carrying everything the three charts read: the actual temp, the
  // consensus forecast + its signed error, plus each source's forecast, its own
  // observation, its signed error, and an asymmetric band reaching the actual.
  const rows = daily.map((d) => {
    const actual = actualOf(d);
    const cons = consensusOf(d);
    const row: Record<string, any> = {
      date: shortDate(d.date), actual, consensus: cons,
      consensus_err: cons != null && actual != null ? round1(cons - actual) : null,
    };
    for (const s of sources) {
      const fc = fcOf(d, s);
      row[`${s}_fc`] = fc;
      row[`${s}_own`] = ownOf(d, s);
      row[`${s}_err`] = fc != null && actual != null ? round1(fc - actual) : null;
      row[`${s}_band`] = fc != null && actual != null ? (fc >= actual ? [fc - actual, 0] : [0, actual - fc]) : null;
    }
    return row;
  });

  // The series the error charts + chips render: each visible source, plus the
  // consensus when toggled on. Both error charts and the chips iterate this list so
  // they always agree on what's shown and in what colour.
  const errorSeries: { key: string; errKey: string }[] = [
    ...visibleSources.map((s) => ({ key: s, errKey: `${s}_err` })),
    ...(showCons ? [{ key: "consensus", errKey: "consensus_err" }] : []),
  ];
  const errsFor = (errKey: string) => rows.map((r) => r[errKey]).filter((e): e is number => e != null);

  // Symmetric y-domain so the zero baseline sits dead center in both charts.
  const dayErrs = rows.flatMap((r) => errorSeries.map((se) => r[se.errKey])).filter((e): e is number => e != null);
  const dayMax = Math.max(6, Math.ceil(Math.max(0, ...dayErrs.map(Math.abs)) + 1));

  // Scatter: error vs how hot/cold the day got, one series per source (+ consensus),
  // plus a fitted trend line spanning the shared x-range.
  const valOf = (d: Daily, key: string) => (key === "consensus" ? consensusOf(d) : fcOf(d, key));
  const scatter = errorSeries.map(({ key }) => ({
    key,
    points: daily
      .map((d) => {
        const a = actualOf(d), v = valOf(d, key);
        return a != null && v != null
          ? { x: a, y: round1(v - a), date: shortDate(d.date), fc: v, source: key }
          : null;
      })
      .filter((p): p is NonNullable<typeof p> => p != null),
  }));
  const allX = scatter.flatMap((o) => o.points.map((p) => p.x));
  const xMin = allX.length ? Math.min(...allX) : 0;
  const xMax = allX.length ? Math.max(...allX) : 0;
  const allY = scatter.flatMap((o) => o.points.map((p) => p.y));
  const scatMax = Math.max(6, Math.ceil(Math.max(0, ...allY.map(Math.abs)) + 1));
  const trends = scatter
    .map(({ key, points }) => {
      const r = regression(points);
      if (!r || xMin === xMax) return null;
      return {
        key,
        line: [
          { x: xMin, y: round1(r.intercept + r.slope * xMin) },
          { x: xMax, y: round1(r.intercept + r.slope * xMax) },
        ],
      };
    })
    .filter((t): t is NonNullable<typeof t> => t != null);

  const dirWord = (v: number) => (Math.abs(v) <= GOOD_BAND ? "on target" : v > 0 ? "ran warm" : "ran cool");
  const errColor = (v: number) => (Math.abs(v) <= GOOD_BAND ? "var(--muted)" : v > 0 ? WARM : COOL);

  const dayTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload;
    const items = errorSeries
      .map(({ key }) => ({
        key,
        err: row[key === "consensus" ? "consensus_err" : `${key}_err`] as number | null,
        fc: (key === "consensus" ? row.consensus : row[`${key}_fc`]) as number | null,
      }))
      .filter((i) => i.err != null);
    if (!items.length) return null;
    return (
      <div className="acc-tip">
        <div className="acc-tip-head">
          {label} · actual {row.actual ?? "—"}° <span className="muted">({actualLabel})</span>
        </div>
        {items.map(({ key, err, fc }) => (
          <div key={key} className="acc-tip-row">
            <span className="acc-tip-src"><span className="src-dot" style={{ background: colorOf(key) }} />{labelOf(key)}</span>
            <span className="acc-tip-val">
              <span className="muted">{fc}° → </span>
              <span style={{ color: errColor(err!), fontWeight: 700 }}>{signed(err!)}°</span>{" "}
              <span className="muted">{dirWord(err!)}</span>
            </span>
          </div>
        ))}
      </div>
    );
  };

  const scatterTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload;
    if (p?.date == null) return null; // skip trend-line endpoints
    return (
      <div className="acc-tip">
        <div className="acc-tip-head">{p.date} · {labelOf(p.source)}</div>
        <div className="acc-tip-row">
          <span className="muted">actual {actualLabel}</span><span className="acc-tip-val">{p.x}°</span>
        </div>
        <div className="acc-tip-row">
          <span className="muted">forecast</span><span className="acc-tip-val">{p.fc}°</span>
        </div>
        <div className="acc-tip-row">
          <span className="muted">error</span>
          <span className="acc-tip-val" style={{ color: errColor(p.y), fontWeight: 700 }}>{signed(p.y)}° <span style={{ fontWeight: 400 }}>{dirWord(p.y)}</span></span>
        </div>
      </div>
    );
  };

  const oneDay = daily.length < 2;

  return (
    <div style={{ marginTop: 12 }}>
      <div className="acc-toggles">
        <ToggleGroup value={metric} onChange={setMetric} options={[["high", "Daily high"], ["low", "Daily low"]]} />
        <div className="toggle-group">
          {sources.map((s) => (
            <button
              key={s}
              className={`toggle${shown[s] !== false ? " on" : ""}`}
              onClick={() => setShown((p) => ({ ...p, [s]: p[s] === false }))}
              title={shown[s] !== false ? "Hide this source" : "Show this source"}
            >
              <span className="src-dot" style={{ background: sourceColors[s], opacity: shown[s] !== false ? 1 : 0.35 }} />
              {sourceLabels[s] || s}
            </button>
          ))}
        </div>
        {hasConsensus && (
          <div className="toggle-group">
            <button
              className={`toggle${showConsensus ? " on" : ""}`}
              onClick={() => setShowConsensus((v) => !v)}
              title={showConsensus ? "Hide the consensus (all charts)" : "Show the consensus (all charts)"}
            >
              <span className="src-dot" style={{ background: CONSENSUS_COLOR, opacity: showConsensus ? 1 : 0.35 }} />
              Consensus
            </button>
          </div>
        )}
      </div>

      {/* Headline: typical miss + lean, per source (and consensus), current metric. */}
      <div className="acc-stats">
        {errorSeries.map(({ key, errKey }) => {
          const st = statOf(errsFor(errKey));
          return (
            <div className={`acc-stat${key === "consensus" ? " consensus" : ""}`} key={key}>
              <span className="src-dot" style={{ background: colorOf(key) }} />
              <span className="acc-stat-name">{labelOf(key)}</span>
              {st ? (
                <>
                  <span className="acc-stat-mae" data-q={quality(st.mae)} title="typical miss (mean absolute error)">±{st.mae}°</span>
                  <span className="acc-stat-bias" title="average signed error">
                    {signed(st.bias)}° · {biasWord(st.bias)}
                  </span>
                </>
              ) : (
                <span className="muted">no scored days</span>
              )}
            </div>
          );
        })}
        <div className="acc-legend">
          <span><i className="zone-chip warm" />ran warm</span>
          <span><i className="zone-chip ok" />within ±{GOOD_BAND}°</span>
          <span><i className="zone-chip cool" />ran cool</span>
        </div>
      </div>

      <div className="acc-chart-grid">
        {/* LEFT — the raw picture: observed temps with each forecast laid over them. */}
        <div className="chartbox">
          <h3>Forecast vs actual {metric} (°F)</h3>
          <p className="chart-sub">
            Solid = observed (<span style={{ color: ACTUAL_COLOR, fontWeight: 600 }}>white</span> is your {actualLabel}, each colored solid is that
            source's own station). Dashed = the source's forecast; the tick on each marks its gap to actual.
            {showCons && (
              <> The <span style={{ color: CONSENSUS_COLOR, fontWeight: 600 }}>gold</span> dashed line is the sources' consensus (their average forecast).</>
            )}
          </p>
          <ResponsiveContainer width="100%" height={540}>
            <LineChart data={rows} margin={{ top: 4, right: 10, bottom: 0, left: -8 }}>
              <CartesianGrid stroke="#2d3742" />
              <XAxis dataKey="date" tick={tickStyle} interval="preserveStartEnd" minTickGap={28} />
              <YAxis tick={tickStyle} width={38} unit="°" domain={["auto", "auto"]} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "#8b98a5" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
              <Line dataKey="actual" name={`Actual — ${actualLabel}`} stroke={ACTUAL_COLOR} strokeWidth={2.5}
                dot={{ r: 3 }} connectNulls isAnimationActive={false} />
              {showCons && (
                <Line dataKey="consensus" name="Consensus forecast" stroke={CONSENSUS_COLOR} strokeWidth={2}
                  strokeDasharray="8 3" dot={{ r: 3 }} connectNulls isAnimationActive={false} />
              )}
              {visibleSources.map((s) => [
                <Line key={`${s}_fc`} dataKey={`${s}_fc`} name={`${sourceLabels[s] || s} forecast`} stroke={sourceColors[s]}
                  strokeWidth={1.5} strokeDasharray="5 4" dot={{ r: 3 }} connectNulls isAnimationActive={false}>
                  <ErrorBar dataKey={`${s}_band`} stroke={sourceColors[s]} strokeWidth={1.5} width={5} direction="y" />
                </Line>,
                <Line key={`${s}_own`} dataKey={`${s}_own`} name={`${sourceLabels[s] || s} observed`} stroke={sourceColors[s]}
                  strokeWidth={1.5} strokeOpacity={0.85} dot={false} connectNulls isAnimationActive={false} />,
              ])}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* RIGHT — the same miss distilled two ways. */}
        <div className="acc-chart-right">
          <div className="chartbox">
            <h3>Error by day — forecast minus actual {metric}</h3>
            <p className="chart-sub">
              How far each source missed, per day. Bars above the line
              <span className="warm-t"> ran warm</span>, below <span className="cool-t">ran cool</span>; inside the grey corridor was within ±{GOOD_BAND}°.
            </p>
            <ResponsiveContainer width="100%" height={228}>
              <BarChart data={rows} margin={{ top: 4, right: 10, bottom: 0, left: -8 }} barCategoryGap="22%">
                <CartesianGrid stroke="#2d3742" vertical={false} />
                <ReferenceArea y1={GOOD_BAND} y2={dayMax} fill={WARM} fillOpacity={0.05} ifOverflow="hidden" />
                <ReferenceArea y1={-dayMax} y2={-GOOD_BAND} fill={COOL} fillOpacity={0.05} ifOverflow="hidden" />
                <XAxis dataKey="date" tick={tickStyle} interval="preserveStartEnd" minTickGap={24} />
                <YAxis tick={tickStyle} width={38} unit="°" domain={[-dayMax, dayMax]} allowDecimals={false} />
                <ReferenceLine y={GOOD_BAND} stroke={ZERO} strokeDasharray="2 4" strokeOpacity={0.5} />
                <ReferenceLine y={-GOOD_BAND} stroke={ZERO} strokeDasharray="2 4" strokeOpacity={0.5} />
                <ReferenceLine y={0} stroke={ZERO} strokeWidth={1.5} />
                <Tooltip content={dayTooltip} cursor={{ fill: "rgba(139,152,165,.08)" }} />
                {errorSeries.map(({ key, errKey }) => (
                  <Bar key={key} dataKey={errKey} fill={colorOf(key)} radius={2} maxBarSize={26} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="chartbox">
            <h3>Error by temperature — misses more when {metric === "high" ? "hot" : "cold"}?</h3>
            <p className="chart-sub">
              Each dot is a day: x = how {metric === "high" ? "hot" : "cold"} it got, y = the miss. A line sloping
              away from zero means that source degrades on {metric === "high" ? "hotter" : "colder"} days.
            </p>
            <ResponsiveContainer width="100%" height={228}>
              <ScatterChart margin={{ top: 4, right: 12, bottom: 0, left: -8 }}>
                <CartesianGrid stroke="#2d3742" />
                <ReferenceArea y1={GOOD_BAND} y2={scatMax} fill={WARM} fillOpacity={0.05} ifOverflow="hidden" />
                <ReferenceArea y1={-scatMax} y2={-GOOD_BAND} fill={COOL} fillOpacity={0.05} ifOverflow="hidden" />
                <XAxis type="number" dataKey="x" name="actual" unit="°" tick={tickStyle} domain={["dataMin - 2", "dataMax + 2"]} allowDecimals={false} />
                <YAxis type="number" dataKey="y" name="error" unit="°" tick={tickStyle} width={38} domain={[-scatMax, scatMax]} allowDecimals={false} />
                <ReferenceLine y={0} stroke={ZERO} strokeWidth={1.5} />
                <Tooltip content={scatterTooltip} cursor={{ strokeDasharray: "3 3" }} />
                {trends.map(({ key, line }) => (
                  <Scatter
                    key={`${key}_trend`} data={line} line={{ stroke: colorOf(key), strokeWidth: 1.5, strokeDasharray: "5 4", strokeOpacity: 0.7 }}
                    shape={() => <g />} isAnimationActive={false} legendType="none"
                  />
                ))}
                {scatter.map(({ key, points }) => (
                  <Scatter key={key} name={labelOf(key)} data={points} fill={colorOf(key)} isAnimationActive={false}>
                    {points.map((_, i) => <Cell key={i} />)}
                  </Scatter>
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="note">
        {oneDay && `Only ${daily.length} day scored so far — the time series and trends sharpen as more complete days accumulate. `}
        Error throughout = each source's forecast minus the day's actual {metric}, measured against{" "}
        <strong>{actualLabel}</strong>{hasPurpleair ? " (your local sensor)" : " (the cross-source mean)"}. The left chart is the
        raw picture; the right two distill the miss — by day (warm vs. cool) and by temperature (does it degrade when{" "}
        {metric === "high" ? "hot" : "cold"}?). The chips show each source's <strong>typical miss</strong> (±MAE) and{" "}
        <strong>lean</strong> (signed bias){showCons && <> — including the <span style={{ color: CONSENSUS_COLOR, fontWeight: 600 }}>consensus</span>, the sources' average, in every chart</>}.
        The accuracy table above splits the same error against each source's <em>own</em> station vs. PurpleAir.
      </div>
    </div>
  );
}
