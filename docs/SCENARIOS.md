# Weather scenario gallery

Run `npm run dev`, then open **http://localhost:3002/weather/scenarios**.
The selector renders the same dashboard components as the live page with synthetic
inputs and a fixed clock. It makes no weather requests or changes to saved data;
settings and collection controls are absent. The gallery is disabled in production
unless `WEATHER_SCENARIOS=1` is explicitly set on the server.

Twenty-four scenarios cover warm/cool bias, asymmetric bias, accurate forecasts,
residual error after adjustment, high/low breaches,
morning/evening projections, midnight rollover, new and missing sensors, sparse and
stale observations, source disagreement/failure, severe weather, and outages.
Each scenario shows its expected behavior above the dashboard.

The gallery opens in forecast overview mode. Use **Show all views, including
accuracy and history** to include the analytical charts. Each case has a direct
URL, for example `/weather/scenarios?scenario=high-breach&view=all`.

Check the summary, interactive yesterday/today/tomorrow chart, daily comparisons,
source table, forecast accuracy charts (including high/low and source toggles),
history charts, and outlier leaderboard. Try 320px, 390px, and desktop widths.
Daily/weekly date-selector views are not implemented yet and are not covered.

`lib/scenarios.mjs` builds synthetic raw observations and logged forecasts, then
uses the production forecast reducers, alert rules, and `scoreAccuracy` core to
derive scores and projections. `lib/scenarios.test.mjs` verifies deterministic
serialization, date boundaries, bias signs, projection horizons, breaches, gaps,
provider failures, and alerts. Run `npm test` for these and existing tests.

This exercises deterministic UI and calculation states, not provider-network
integration or statistical proof that a local adjustment improves forecasts.

The three-day graph runs chronologically from yesterday through tomorrow on a
72-hour axis. Today has hourly points; the outer days use 3-hour averages with
coverage in the tooltip. All days stay visible, with midnight dividers and a
highlighted today region. The accessible slider steps through all 40 intervals.
Solid lines are observations; dashed lines are forecasts. Empty intervals remain
gaps, and partial intervals report their available hourly sample count.

Each day draws ONE forecast curve, labeled `Forecast*` when a local adjustment is
applied. The adjustment is a single flat offset — the mean error against this
location's observations across the scored days in the 30-day accuracy window,
pooling each day's high and low. It is not computed per hour: an earlier version
ramped the correction across the day's range, interpolating between the high-end
and low-end bias, which inferred a shape the data does not measure. A source that
runs warm on highs and accurate on lows therefore gets one compromise offset, not
a tilt. Note the scenarios cannot tell the two apart — their bias is identical at
both ends, so a ramp and a flat shift coincide; `forecast-adjustment.test.mjs`
covers the asymmetric case instead. Per hour it prefers the trained daily-shape projection (today's remaining
hours only), then the bias-adjusted forecast, then the raw source — so the line
never disappears just because history is thin. A note under the legend spells the
asterisk out with real numbers ("shifted 6° warmer at the high"), and the
unadjusted source curve is overlaid as a dim dotted ghost in each day's own
colour. That overlay defaults ON wherever a correction was applied, because a
well-adjusted forecast sits on top of the observations and would otherwise be
indistinguishable from one that never needed adjusting: at noon `warmer` reads
81.1 observed / 81.1 adjusted / 75.1 source and `cooler` reads 69.1 / 69.1 /
75.1, so the ghost is the only thing separating them on screen. **Show source
forecast** toggles it, and an explicit choice sticks.

Every scenario but one offsets the sensor from the sources by a constant, which
the mean bias cancels exactly — so the adjusted curve lands on the observations
to the decimal, and you cannot see what a partly-corrected forecast looks like.
`residual` adds a day-to-day wobble that sums to zero over any six days: the
learned mean bias is still 6°F, but the per-day errors run -10 to -2 instead of
a flat -6, and today departs from the mean by 4°F. Its observed line sits about
4°F above the adjusted forecast through the morning. Use it when changing
anything about how the adjustment is computed or drawn — the constant-offset
scenarios cannot fail in a way that shows up on screen.

It also exposes a quirk worth knowing when reading the chart: the two curves
converge exactly at "Now". The rest-of-day projection is solved to pass through
the latest observation, so `projCurve[nowHour]` equals that observation by
algebra, in real data as much as synthetic. The forecast-vs-observed comparison
at the current hour is therefore a tautology, not a hit. Both the asterisk and the
toggle are absent when no shift applies: `on-track` sits inside the ±2°F dead-band
and `new-sensor` has no scored days, so both show a plain `Forecast` and no note.
Yesterday has no saved hourly forecast, so its adjustment is a labeled high-low
band rebuilt from the logged daily high/low and the errors on days before it,
never from yesterday's own outcome.
Each day card names its high against the neighboring day ("3° hotter"),
reading observations first and adjusted forecasts where observations are missing.
Today's card adds a short trend for the next few hours ("Warming up · 3° warmer
by 3pm"). The trend compares forecast against forecast three hours apart, never
an observation against a forecast, so a source running warm or cool cannot read
as a trend: every noon scenario agrees on the direction whether or not a local
adjustment exists. After 9pm it continues into tomorrow's hours; `late-night`
and `midnight` cover that crossing, and `early-morning` and `after-peak` cover
the two directions.
Without scored history the band and the comparisons are absent rather than
invented: `accuracy-outage` has no accuracy at all, and `one-day` adjusts from a
single day (its band is absent — the self-scoring cutoff leaves nothing behind it).
A consensus bias within ±2°F is treated as noise and leaves that end unshifted.

## Reference frames

A temperature is only comparable to another one measured off the same
thermometers. Three frames circulate: the raw **source** forecast, the
**sensor-corrected** forecast (source shifted by the bias learned against this
location), and the **pooled-observation** frame the daily shape is trained in.
They can sit degrees apart, and three scenarios exist to keep that visible.

`asymmetric` runs the sensor 8°F warm at the high and exactly on at the low —
the one shape a single pooled offset cannot represent. The chart shifts the whole
curve by the pooled 4°F while the advice card corrects the high by its own 8°F,
so both numbers are on screen at once and have to be described as the different
things they are. Every other bias scenario applies the same offset to both ends,
where a pooled and a per-end correction coincide and cannot be told apart.

`sparse-sensor` has a sensor with 15 readings: enough to score a day of bias
against, below the 16-sample floor `buildDiurnal` needs before it will train the
daily shape on the sensor. The forecast is therefore corrected into the sensor's
frame while the projection can only be trained on the pooled sources, roughly 6°F
away. Use it when changing `forecastCurve` — splicing an adjusted forecast and a
projection into one line is only sound while both are in the same frame, and this
is the scenario where they are not.

`pooled-spread` removes the sensor and sets the sources 14°F apart, so the daily
shape is trained on NWS and Open-Meteo pooled together. Each day's apparent range
inherits the disagreement, and the projected high overshoots what either source
actually forecast. It covers the `use = recent` fallback that every other
sensorless scenario exercises only at a 2°F spread.

The live reality check restates the forecast bounds in the observations' own frame
before calling anything a breach (`comparableBounds`, `breachAt`). Without that, a
sensor reading 6°F warm is "past the forecast high" every afternoon while the
advice card, applying the same per-end bias, calls the identical day on track —
`warmer` and `cooler` are the regression cases in both directions. The correction
applies only when the bias was learned in the frame the reading came from, so a
sensor with history that went quiet today (`sparse-sensor`) is compared against
raw bounds rather than having someone else's offset applied to it. Corrected
bounds carry a `*` and name the sources' published numbers underneath.
