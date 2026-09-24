---
name: weather-compare-dashboard
description: app/page.tsx weather-app layout + the today's-forecast insight components (live reality check, heads-up, diurnal projection)
metadata:
  type: project
---

`app/page.tsx` is one big client component. **Layout order** (restructured 2026-06-20,
commit b2f52cc) — weather-app flow, most useful info first:

1. **Right now — <location>**: `<ForecastNowCheck>` hero (live forecast analysis) +
   `<CurrentConditions>` cards.
1.5. **`<EventAlerts>` + `<TodayChart>`** (added 2026-08-28): high-variance-event cards
   (from `forecast.alerts`, `lib/alerts.mjs` — hidden entirely on a normal day) and the
   compact hour-by-hour today chart (`app/TodayChart.tsx`): observed consensus SOLID
   white / yesterday's observed consensus THIN grey (reference underlay; tooltip shows
   Δ vs yesterday per hour, observed else forecast) / hourly-forecast consensus DASHED
   gold / diurnal rest-of-day DOTTED purple, "now" ReferenceLine + shaded future.
   Temperature only — precip/wind/AQI live in the tooltip footer and the alert cards
   (precip bars removed by request 2026-08-28). **Forecast* is the adjusted source
   curve ALL DAY** (decided 2026-09-15): `forecastCurve(source, adjusted)` in
   `lib/forecast-adjustment.ts` is just adjusted-else-source, where `adjusted` =
   `fitCurve(hourly, forecastRanges.today|tomorrow)` — the hourly consensus mapped
   linearly so its max/min land on the SAME corrected daily high/low the hero and day
   cards show (`dailyRanges().forecast`, Dashboard.tsx; today's card range is
   additionally bounded by observations, the curve's is not). Replaced the flat pooled
   `adjustedCurve` shift the same day: pooled +2.4° sat in the 2° dead-band while the
   high bias alone did not, so the graph peaked 79° under "High 83°" (user screenshot).
   Star + "Source forecast" toggle now key off a per-end correction actually applied
   (`adjustmentSummary(highBias|lowBias).shift`), not off the curves differing. Until then the diurnal
   `projCurve` replaced the forecast from "now" onward, so at 8:26am a 3° warm-up ÷
   f≈0.2 drew a 70° afternoon under an 84° hero high (user screenshot). A
   confidence blend (weight = pctToPeak/100) was tried the same day and dropped: a
   curve bent toward today's own readings erases the observed-vs-forecast shading and
   makes the hero delta near-circular (the 2026-09-11 RECONSIDER note). Consequences:
   the hero's "cooler than expected" now measures against the forecasters (a slow
   morning reads ~5°, not 1°); `accuracy.diurnal` no longer feeds the chart at all —
   it lives only in the hero's headed-warmer/on-track/peak-footer copy. Scenario
   `slow-morning` (hour 8, `todayHigh: 72` under an 84° forecast) shows it.
   CSS `.event-alert[data-sev]`, `.today-chart`.
   **Observed line reaches the marker** (2026-09-15): `withLatestReading` +
   `interpolateHour` (`lib/temperature-timeline.ts`) insert today's latest observation
   as one extra row at its TRUE fractional local hour (`row.latest = true`, forecasts
   interpolated so the warm/cool shading and tooltip continue to it; a reading on the
   hour adds nothing). The "now" `ReferenceLine` sits at that same minute and is
   labelled `"69° · 11:00am"` (the reading's clock — the hero's "N° cooler than forecast
   at 11:00am" uses the same one), falling back to the wall clock + "Now" only when
   there is no reading today; no marker on a historical date. Before this the hourly
   buckets plotted at the top of the hour and the marker at the wall-clock minute, so the
   solid line stopped up to an hour short of the dashed line. No flat hold to the wall
   clock is drawn — a 28-min-old reading ends the line 28 min back, honestly.
   **Plain-language temperature scale** (2026-09-15): `TEMP_BANDS` in `lib/constants.mjs`
   (Very hot ≥100 / Hot 90s / Warm 80s / Mild 70s / Cool 60s / Chilly 50s / Cold 40s /
   Very cold 32–39 / Freezing <32) + `lib/temperature-scale.ts` (`bandFor`,
   `temperatureTicks`, `visibleBands`). The left y-axis ticks ARE the band floors inside
   the domain (so the dashed grid lines are band edges; falls back to a 5° grid when
   fewer than two edges fit), and a second right-hand `YAxis` (`yAxisId="bands"`) names
   each band at the midpoint of its visible slice, skipping slivers under
   `MIN_VISIBLE_SPAN=5`°. The band holding `currentTemp` is brightened/bold and drawn as a
   neutral (#e6edf3 @ .07) `ReferenceArea` across the TODAY section only (user chose it
   2026-09-15 after seeing it; it reads best mid-plot, weaker when clipped at an edge),
   and `domainShowingBand` widens the y-domain so that band always shows ≥5° — without it
   a reading a degree inside a band at the plot edge lost its label (fixed same day).
   Bands are NOT colour-tinted on purpose — red/blue already mean "vs forecast" here.
   Same change removed yesterday's purple forecast-range `ReferenceArea` (noise against
   the day-divider line); yesterday's forecast hi/lo survive in the tooltip only and no
   longer stretch the y-domain. Scenarios `heat-wave` / `cold-snap` (`baseHigh`/`baseLow`
   config) exercise both ends of the scale.
2. **Today's forecast — high/low · date**: `<ForecastSection>` = consensus high/low cards
   + `<ForecastAdvice>` heads-up (side by side in the `.forecast-top` grid). The hero
   verdict also carries an always-on `.nowcheck-conditions` line (2026-09-01): sky +
   rain chance via `condIcon`/`precipLabel` — sub-alert-threshold rain (a 12% drizzle
   day) is visible here even when no alert card fires. `condIcon(cond, precipProb)`
   only shows 🌧️/⛈️/🌨️ when the chance is high (`RAIN_PROB=40` from `lib/constants.mjs`,
   shared with the rain heads-up card in `lib/alerts.mjs`, or — with no
   number — NWS wording without a "Chance/Isolated/Scattered" hedge); otherwise it
   falls through to the sky words, so "Slight Chance Drizzle then Mostly Sunny" at
   12% is ☀️ with "12% rain" beside it (user request 2026-09-01). After the heads-up:
   `<TomorrowCard>` (2026-09-01, `.yday.tmrw` shell) — tomorrow's consensus hi/lo,
   conditions + rain, trend vs TODAY'S forecast (forecast-vs-forecast, bias cancels;
   `TMRW_SAME_TOL=2` drives tone), and the bias-corrected local number when the lean
   is notable (reuses `leanFor`/`consensusBiasFor`). Data from `forecast.tomorrow`.
3. **Compare sources — right now**: `<CurrentReadings>` table.
4. **Forecast accuracy**: `<AccuracySection>` (table + `AccuracyCharts`).
5. **History**: `<HistoryCharts>`.  6. **Outlier leaderboard**: `<Leaderboard>`.

Three forecast-insight components (all in page.tsx); data from `/api/data` (`data`),
`/api/forecast` (`forecast`), `/api/accuracy` (`accuracy`):

- **`ForecastNowCheck`** (the hero) — "is the forecast already wrong, right now?" Current
  temp = `data.latest.purpleair.temp_f` else `consensus(data,"temp_f")`. Today's running
  high/low = `localSoFar(accuracy)` (PA `purpleairSoFar` else broadest `observedSoFar`)
  combined with current temp. Verdicts (drive `data-tone` warm/cool/ok): **Warmer / Colder
  than expected** (a bound already passed), **Headed warmer than expected** (projected to
  pass via diurnal `estHigh`), **Outside the forecast range**, **On track with the forecast**.
  Only asserts "wrong" once a bound is actually passed (running high only rises, low only
  falls). `NOWCHECK_TOL=1`. Uses `accuracy.diurnal` for pacing copy + a peak/valley footer.
  Renders the current temp even before `forecast` has loaded. Hero head (2026-08-28): the
  big temp is labelled with when it was collected (`fmtClock`, e.g. "4:29pm · The sources",
  full timestamp on hover) not "now", and the hi/lo block is a 3-col grid — FORECAST
  (with ~peak/trough times) beside SO FAR (today's running high/low). `localSoFar` falls
  back from the PA branch to the cross-source envelope when `hasPurpleair` is true only
  from old history and the sensor has nothing today (stale-sensor fix, 2026-08-28).

- **`ForecastAdvice`** (heads-up card) — "what to expect today" from the consensus's
  *historical* bias. `consensusBiasFor(accuracy, high|low)` = mean signed error of the
  consensus forecast vs local actual (PA if `hasPurpleair`, else cross-source mean) over
  scored days. `leanFor()` → kind hotter/colder/track/none + bias-corrected `expected`.
  Action line: "Take it at face value" / "Consider it ~X° hotter/colder than forecast".
  Spread note is worded to *cohere* with the action (the consensus splits the gap when it
  tracks well — not a contradictory "give it room"). `ADVICE_BIAS_NOTABLE=2`, `ADVICE_SPREAD_WIDE=4`.

- **`forecastBreach(data, forecast, accuracy)`** → `{highBlown, lowBlown, highSoFar, lowSoFar}`
  — the shared "has today already passed a forecast bound?" (same rule/tolerance as the live
  check). `ForecastSection` flags a disproven forecast THREE ways: heading "· already off
  today", a `.stale` dimmed card with "⚠ already passed — hit X°", and `ForecastAdvice` (given
  `breach`) flips to **"Forecast already off today / Already warmer than forecast"** instead of
  "take it at face value" — keeping it consistent with the hero.

- **`buildDiurnal`** (in `lib/accuracy.mjs`, surfaced as `accuracy.diurnal`) — a normalized
  fraction-of-range-by-local-hour curve from **up to the last 30 days** (PurpleAir samples if
  they have ≥16 samples INSIDE the window, else all sources pooled — a sensor tried once long
  ago must not null the projection; fixed 2026-08-28). Finds `peakHour`/`troughHour`, then
  extrapolates today's still-to-come high (`estHigh`) from where the current temp sits on the
  curve: `range = (Tnow − todayMin) / f(now)`. Hedged → null (or `estHigh:null`) unless ≥2
  training days, ≥16 samples, now between trough & peak, and `f(now)` in [0.12, 0.99). Also
  returns `pctToPeak`, `nowHour`, `profileDays`, and `projCurve` (2026-08-28): a 24-slot
  rest-of-day hour-by-hour temp shape (nulls before now / where the profile is empty), from
  the solved range pre-peak or the realized range at/past the peak (`f(now) ≥ 0.99` counts —
  the hour leading into the peak, where the solve refuses to divide). Deliberately un-pinned;
  the TodayChart anchors it to its observed line.

Other UI: **`CurrentConditions`** cards use `actualObs(data, metric)` = the local PA reading
when it reports the metric, else the **nearest** source that does (so Wind, which PA can't
measure, comes from the nearest weather source) — a real observation, not a consensus average;
each card labels its source. Replaced the old consensus `GlanceCards` (2026-06-20).
**`CurrentReadings`** (extracted from the old inline table) has a per-source **"Last reading"**
row via `relTime()` (relative age, exact timestamp on hover). The standalone "Today's forecast
by source" table was removed 2026-06-20 (redundant with the accuracy "today so far" provisional).

Related: [[weather-compare-forecast]] (forecast + accuracy backend & AccuracyCharts),
[[weather-compare-location-model]].
