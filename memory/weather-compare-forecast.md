---
name: weather-compare-forecast
description: How the daily forecast comparison + consensus works in weather-compare
metadata:
  type: project
---

"Today's forecast" section (added 2026-06-16) compares daily **high/low** across
forecast-capable sources with a consensus. Distinct from current-conditions:

- `lib/forecast.mjs` — `FORECASTERS` registry (nws, open_meteo), `collectForecasts`,
  `forecastConsensus`. PurpleAir is excluded (a live sensor, no forecast). NWS uses
  `points → forecast` periods (first daytime = high, first nighttime = low);
  Open-Meteo uses `daily=temperature_2m_max,temperature_2m_min`. Since 2026-08-28 each
  forecaster also returns `byHour[date][hour]` (temp/precip_prob/precip_in/wind/gust;
  NWS via `forecastHourly` best-effort, OM via `&hourly=`), merged by `hourlyForDate()`:
  consensus temp = mean, risk fields = max across sources.
- `GET /api/forecast?loc=<id>` — **live, not stored** (unlike `/api/data` which is
  from history). Returns per-source forecasts + `consensus` (average + spread), a
  `tomorrow` block (2026-09-01: `{date, forecasts, consensus}` for the next local day,
  from the same fetch — feeds the dashboard's TomorrowCard), plus
  (2026-08-28) `utc_offset_seconds`, `hourly` (24 merged rows, `aqi` merged in from the
  OM air-quality hourly forecast), and `alerts` from `lib/alerts.mjs`: official NWS
  advisories (`alerts/active?point=`) + anomaly rules — rain/storm/snow (absolute
  thresholds), wind & AQI vs the location's own 30-day p95 (`historyStats`, needs ≥50
  readings) with absolute floors, abnormal high/low vs mean±max(8°, 2σ) (≥5 days).
  `buildAlerts` is pure; thresholds are consts at the top of `lib/alerts.mjs`;
  severity "warning" (red) sorts before "notice" (amber). Quiet day → `[]`, UI hides.
- UI: fetched via `loadForecast` (own loading state) on mount/location-switch/collect.
  `ForecastSection` now renders just the consensus **high/low cards** + the heads-up
  card; the old per-source forecast table (with `source_url` verify links) was removed
  2026-06-20 (covered by the accuracy "today so far" provisional). Consensus = average;
  spread color by `SPREAD_THRESHOLDS.temp_f` ([2,5]). The today's-forecast **insight UI**
  (live reality check, heads-up, diurnal projection, weather-app layout) lives in
  [[weather-compare-dashboard]].
- `lib/http.mjs` — shared `getJSON` (UA + error wrapping), now used by both
  sources.mjs and forecast.mjs. Extend with more fields/sources the same way.

**Forecast accuracy** (added 2026-06-16) — 1-day-ahead, scored per source:
- Forecasters return `byDate` maps; the collector logs **tomorrow's** forecast each
  run to `forecasts.json` via `lib/forecastdb.mjs` (`logForecasts`, upsert by
  loc/source/target_date). Frozen once the day passes = a fair 1-day-ahead.
- `lib/accuracy.mjs` (`buildAccuracy`) scores each logged forecast **vs own
  observed high/low** (NWS from snapshots, Open-Meteo from its `archive-api`) and
  **vs PurpleAir** observed high/low. Reports MAE + bias (high & low), plus a
  **station gap** (own − PurpleAir) to separate model error from siting. Observed
  daily high/low is reconstructed from collected snapshots, bucketed into local days
  via the archive's `utc_offset_seconds` (timezone-correct).
- `GET /api/accuracy?loc=<id>`; UI `AccuracySection` (loadAccuracy). Until a
  completed forecast-day exists it shows a **provisional "today so far"** view
  (today's forecast vs observed-so-far from snapshots) for immediate feedback.
  NWS/PurpleAir fill in next day; Open-Meteo own-obs lags the archive ~1-2 days.
- The payload's per-day `daily` series carries, per source, `forecastHigh/Low` and
  the errors vs own & PA, plus the day's `paHigh/Low` and mean `actualHigh/Low`.
  `app/AccuracyCharts.tsx` (shown at ≥1 scored day) was **redesigned 2026-06-18** for
  legibility, then settled on a **3-chart, 2-column layout** (`.acc-chart-grid`,
  ~1.3fr/1fr, collapses to 1 col <920px). LEFT = the original **forecast-vs-actual time
  series** (`<LineChart>`, kept on request): observations SOLID (white = your
  PurpleAir/consensus, colored = each source's own station), forecasts DASHED with a
  recharts `<ErrorBar>` band (asymmetric `[down,up]` reaching actual = the error tick);
  Legend `iconType="plainline"` distinguishes dashed/solid. RIGHT = two stacked error
  charts (`.acc-chart-right`) that distill the same miss: **(1) Error by day** —
  `<BarChart>` of signed error per day per source (grouped bars from zero); **(2) Error
  by temperature** — `<ScatterChart>` of error vs the day's actual temp + a per-source
  least-squares **trend line** (`regression()`, drawn only at ≥3 pts via
  `<Scatter line shape={()=>null}>`). Shared visual language on the two error charts:
  **grey corridor = on target (±GOOD_BAND=3°), red zone = ran warm, blue = ran cool**
  (`<ReferenceArea>` tints above +3 / below −3, dashed ±3 lines, bold zero baseline).
  Single error definition everywhere = `forecast − actualOf(d)`, `actualOf` = PurpleAir
  if `hasPurpleair` else consensus mean (≈ `errPa`). Above all three: headline **stat
  chips** per source (±MAE color-coded good/mid/bad ≤2/≤5, signed bias + "runs
  warm/cool/balanced"), from the same `rows` the bars use. Custom tooltips on the error
  charts read "79° → +2° on target". Daily-high/low + per-source show/hide toggles drive
  all three; a **Consensus** toggle (gold `#fbbf24`, the sources' average) overlays a 4th
  series in every chart — dashed line in the time series, a bar in error-by-day, a dot+trend
  in error-by-temperature — plus its own stat chip (added 2026-06-18). vs-own vs vs-PA split
  (model error vs siting) stays in the table above.
  Heights: time series 540, each error chart 228. CSS: `.acc-chart-grid/.acc-chart-right`,
  `.acc-stats/.acc-stat`, `.zone-chip`, `.chart-sub`, `.acc-tip*` in `globals.css`.
- **Date integrity** (fixed 2026-06-17): `collectForecasts` derives today/tomorrow
  from the Open-Meteo `utc_offset_seconds`, NOT the date-array index (which lagged
  near local midnight and once logged a same-day forecast that overwrote the real
  1-day-ahead row). `buildAccuracy` counts a forecast only if issued **before the
  target day's local noon** (before the afternoon high) — forgives a past-midnight
  straggler but excludes same-day-afternoon forecasts. (An earlier strict "made
  before target_date" rule zeroed out the first scored day, because the midnight bug
  stamped that forecast 00:27 *on* the target day — fixed 2026-06-18.)
- True 1-day-ahead can't be backfilled (NWS has no archived forecasts; Open-Meteo's
  historical-forecast API isn't a clean fixed lead). So it logs forward only.

Related: [[weather-compare-location-model]].
