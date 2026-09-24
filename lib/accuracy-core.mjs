// Pure accuracy and projection calculations. No disk or network access.
const DAY_MS = 86400000;
const utcDate = (ms) => new Date(ms).toISOString().slice(0, 10);
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const rWhole = (x) => (x == null ? null : Math.round(x));

const SOURCES = ["nws", "open_meteo"]; // forecast-capable sources

export function scoreAccuracy(location, { readings, forecasts, omActual = {}, nowMs, offsetSec = 0, windowDays = 30 }) {
  const todayLocal = new Date(nowMs + offsetSec * 1000).toISOString().slice(0, 10);
  const localDateOf = (ts) => new Date(Date.parse(ts) + offsetSec * 1000).toISOString().slice(0, 10);
  const localHourOf = (ts) => {
    const d = new Date(Date.parse(ts) + offsetSec * 1000);
    return d.getUTCHours() + d.getUTCMinutes() / 60;
  };

  // Observed daily high/low per (source, local date) from our collected snapshots, plus
  // per-reading (local hour, temp) samples for the diurnal-shape extrapolation below.
  const obs = {}; // source -> date -> { hi, lo }
  const samples = []; // { source, date, hour, temp }
  for (const row of readings) {
    if (row.status !== "ok" || row.temp_f == null) continue;
    const date = localDateOf(row.ts);
    const cell = ((obs[row.source] ||= {})[date] ||= { hi: -Infinity, lo: Infinity });
    if (row.temp_f > cell.hi) cell.hi = row.temp_f;
    if (row.temp_f < cell.lo) cell.lo = row.temp_f;
    samples.push({ source: row.source, date, hour: localHourOf(row.ts), temp: row.temp_f });
  }
  const hasPurpleair = !!obs.purpleair;
  const diurnal = buildDiurnal(samples, { nowMs, offsetSec, todayLocal, hasPurpleair, windowDays });
  const snapHighLow = (source, date) => {
    const c = obs[source]?.[date];
    return c ? { high_f: rWhole(c.hi), low_f: rWhole(c.lo) } : null;
  };
  const ownActual = (source, date) =>
    source === "open_meteo" ? omActual[date] || null : snapHighLow(source, date);
  const paActual = (date) => snapHighLow("purpleair", date);

  // Forecasts for completed days within the window. A forecast counts only if it was
  // issued before the target day's high could be observed (before local noon) — this
  // still excludes a genuine same-day-afternoon "forecast" that already saw the high,
  // but forgives one logged a few minutes past local midnight (the daily high is in
  // the afternoon, so an early-morning forecast hasn't peeked).
  const windowStart = utcDate(nowMs - windowDays * DAY_MS);
  const fcByDate = {}; // date -> source -> forecast row
  for (const f of forecasts) {
    if (f.target_date >= todayLocal || f.target_date < windowStart) continue;
    const targetNoonMs = Date.parse(`${f.target_date}T12:00:00Z`) - offsetSec * 1000;
    if (Date.parse(f.made_at) >= targetNoonMs) continue; // issued after the day's high
    (fcByDate[f.target_date] ||= {})[f.source] = f;
  }

  const acc = {};
  for (const s of SOURCES) {
    acc[s] = { ownHigh: [], ownLow: [], paHigh: [], paLow: [], gapHigh: [], gapLow: [], days: new Set() };
  }

  // Per-day series for charts: each completed day's per-source error (vs own and vs
  // PurpleAir, high and low) plus a reference "actual" high/low for the day (the
  // mean of available actuals) to use as the hot/cold axis.
  const daily = [];
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
  for (const date of Object.keys(fcByDate).sort()) {
    const bySource = fcByDate[date];
    const pa = paActual(date);
    const entry = { date, sources: {} };
    const highActuals = [], lowActuals = [];
    for (const s of SOURCES) {
      const fc = bySource[s];
      const own = fc ? ownActual(s, date) : null;
      const heOwn = fc && own && fc.high_f != null && own.high_f != null ? fc.high_f - own.high_f : null;
      const leOwn = fc && own && fc.low_f != null && own.low_f != null ? fc.low_f - own.low_f : null;
      const hePa = fc && pa && fc.high_f != null && pa.high_f != null ? fc.high_f - pa.high_f : null;
      const lePa = fc && pa && fc.low_f != null && pa.low_f != null ? fc.low_f - pa.low_f : null;
      entry.sources[s] = {
        forecastHigh: fc?.high_f ?? null,
        forecastLow: fc?.low_f ?? null,
        ownHigh: own?.high_f ?? null,
        ownLow: own?.low_f ?? null,
        highErrOwn: heOwn, lowErrOwn: leOwn, highErrPa: hePa, lowErrPa: lePa,
      };
      if (!fc) continue;
      const a = acc[s];
      let scored = false;
      if (heOwn != null) { a.ownHigh.push(heOwn); scored = true; }
      if (leOwn != null) { a.ownLow.push(leOwn); scored = true; }
      if (hePa != null) { a.paHigh.push(hePa); scored = true; }
      if (lePa != null) { a.paLow.push(lePa); scored = true; }
      if (own && pa) {
        if (own.high_f != null && pa.high_f != null) a.gapHigh.push(own.high_f - pa.high_f);
        if (own.low_f != null && pa.low_f != null) a.gapLow.push(own.low_f - pa.low_f);
      }
      if (scored) a.days.add(date);
      if (own?.high_f != null) highActuals.push(own.high_f);
      if (own?.low_f != null) lowActuals.push(own.low_f);
    }
    if (pa?.high_f != null) highActuals.push(pa.high_f);
    if (pa?.low_f != null) lowActuals.push(pa.low_f);
    entry.paHigh = pa?.high_f ?? null;
    entry.paLow = pa?.low_f ?? null;
    entry.actualHigh = avg(highActuals);
    entry.actualLow = avg(lowActuals);
    daily.push(entry);
  }

  const stat = (errs) =>
    errs.length
      ? {
          mae: r1(errs.reduce((s, e) => s + Math.abs(e), 0) / errs.length),
          bias: r1(errs.reduce((s, e) => s + e, 0) / errs.length),
          n: errs.length,
        }
      : null;
  const mean = (arr) => (arr.length ? r1(arr.reduce((s, e) => s + e, 0) / arr.length) : null);

  const perSource = SOURCES.map((s) => {
    const a = acc[s];
    return {
      source: s,
      days: a.days.size,
      vsOwn: { high: stat(a.ownHigh), low: stat(a.ownLow) },
      vsPurpleair: { high: stat(a.paHigh), low: stat(a.paLow) },
      obsGap: a.gapHigh.length || a.gapLow.length ? { high: mean(a.gapHigh), low: mean(a.gapLow) } : null,
    };
  });

  // Provisional, in-progress view of *today*: today's forecast vs the high/low
  // observed so far today (from snapshots — the archive doesn't have today yet).
  // Not a final score, but immediate feedback while completed days accumulate.
  const todayForecast = {};
  for (const f of forecasts) if (f.target_date === todayLocal) todayForecast[f.source] = f;
  const provisional = SOURCES.map((s) => {
    const fc = todayForecast[s];
    return {
      source: s,
      forecast: fc ? { high_f: fc.high_f, low_f: fc.low_f } : null,
      observedSoFar: snapHighLow(s, todayLocal),
      purpleairSoFar: snapHighLow("purpleair", todayLocal),
    };
  });

  // Yesterday's consensus forecast (average of the sources' logged forecasts for
  // that local day), for the dashboard's "vs yesterday" card. Comparing it to
  // today's forecast keeps both sides predictions, so the day-over-day delta
  // cancels the forecaster's systematic bias rather than mixing in forecast error
  // (which comparing today's forecast to yesterday's *actual* would do).
  const yLocal = new Date(nowMs + offsetSec * 1000 - DAY_MS).toISOString().slice(0, 10);
  const yRows = forecasts.filter((f) => f.target_date === yLocal);
  const yAvg = (field) => {
    const vals = yRows.map((f) => f[field]).filter((v) => v != null);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  };
  const yHigh = yAvg("high_f"), yLow = yAvg("low_f");
  const yesterday =
    yHigh == null && yLow == null
      ? null
      : { date: yLocal, high_f: yHigh, low_f: yLow, source: "consensus forecast" };

  // Yesterday at ~this local time: the observed temp from yesterday's readings nearest
  // the current local hour (local sensor preferred), for an actual-vs-actual "warmer/
  // cooler than yesterday right now" comparison. Within 1.5h of now to stay "this time".
  const nowHourFrac = (() => {
    const d = new Date(nowMs + offsetSec * 1000);
    return d.getUTCHours() + d.getUTCMinutes() / 60;
  })();
  let yAtBest = null;
  for (const s of samples) {
    if (s.date !== yLocal) continue;
    if (hasPurpleair && s.source !== "purpleair") continue; // sensor first, for consistency with "now"
    const diff = Math.abs(s.hour - nowHourFrac);
    if (diff <= 1.5 && (!yAtBest || diff < yAtBest.diff)) yAtBest = { diff, temp: s.temp, hour: s.hour };
  }
  const yesterdayAtTime = yAtBest
    ? { date: yLocal, temp: rWhole(yAtBest.temp), hour: r1(yAtBest.hour), source: hasPurpleair ? "your sensor" : "local observations" }
    : null;

  return {
    location,
    windowDays,
    todayLocal,
    yesterday,
    yesterdayAtTime,
    scoredDays: Object.keys(fcByDate).length,
    forecastsLogged: forecasts.length,
    hasPurpleair,
    ownActualSource: { nws: "its own observations", open_meteo: "Open-Meteo archive" },
    perSource,
    provisional,
    daily,
    diurnal,
  };
}

export function buildDiurnal(samples, { nowMs, offsetSec, todayLocal, windowDays }) {
  // Calibrate the daily shape on up to the last `windowDays` of local days.
  // Prefer the local sensor only when it has real depth INSIDE that window — a
  // sensor tried once long ago (or added yesterday) must not null out the whole
  // projection when the pooled sources can carry it.
  const cutoff = new Date(nowMs + offsetSec * 1000 - windowDays * 86400000).toISOString().slice(0, 10);
  const recent = samples.filter((s) => s.date >= cutoff);
  const pa = recent.filter((s) => s.source === "purpleair");
  const src = pa.length >= 16 ? "purpleair" : null;
  const use = src ? pa : recent;
  if (use.length < 16) return null;

  const byDay = {};
  for (const s of use) {
    const d = (byDay[s.date] ||= { min: Infinity, max: -Infinity, list: [] });
    if (s.temp < d.min) d.min = s.temp;
    if (s.temp > d.max) d.max = s.temp;
    d.list.push(s);
  }

  // Average fraction-of-range per local hour, from completed days that actually swung.
  const agg = Array.from({ length: 24 }, () => ({ sum: 0, n: 0 }));
  let profileDays = 0;
  for (const date of Object.keys(byDay)) {
    if (date === todayLocal) continue;
    const d = byDay[date];
    const range = d.max - d.min;
    if (range < 3 || d.list.length < 4) continue;
    profileDays += 1;
    for (const s of d.list) {
      const h = Math.floor(s.hour) % 24;
      agg[h].sum += (s.temp - d.min) / range;
      agg[h].n += 1;
    }
  }
  if (profileDays < 2) return null;
  const profile = agg.map((a) => (a.n ? a.sum / a.n : null));

  let peakHour = null, peakVal = -Infinity, troughHour = null, troughVal = Infinity;
  profile.forEach((v, h) => {
    if (v == null) return;
    if (v > peakVal) { peakVal = v; peakHour = h; }
    if (v < troughVal) { troughVal = v; troughHour = h; }
  });
  if (peakHour == null || troughHour == null) return null;

  const nowLocal = new Date(nowMs + offsetSec * 1000);
  const nowHourFrac = nowLocal.getUTCHours() + nowLocal.getUTCMinutes() / 60;
  const nowHour = Math.floor(nowHourFrac);

  const out = {
    estHigh: null, pctToPeak: null, tNow: null, todayMaxSoFar: null, projCurve: null,
    peakHour, troughHour, nowHour, profileDays, source: src || "all sources",
  };
  const today = byDay[todayLocal];
  if (!today) return out;
  out.todayMaxSoFar = Math.round(today.max);
  const latest = today.list.reduce((a, b) => (b.hour > a.hour ? b : a));
  out.tNow = Math.round(latest.temp);

  // Only project the high while we're between the trough and the peak and the current
  // point sits meaningfully up the curve (avoids dividing by a tiny fraction).
  const fNow = profile[nowHour];
  let range = null;
  if (fNow != null && nowHourFrac > troughHour && nowHourFrac < peakHour && fNow >= 0.12 && fNow < 0.99) {
    const solved = (latest.temp - today.min) / fNow;
    if (solved > 0) {
      range = solved;
      out.estHigh = Math.round(Math.max(today.min + solved, today.max));
      out.pctToPeak = Math.round(fNow * 100);
    }
  } else if ((nowHourFrac >= peakHour || (fNow != null && fNow >= 0.99)) && today.max - today.min >= 3) {
    // At or past the peak the day's range is already (essentially) realized; the
    // rest-of-day curve just follows the typical decline. The fNow≥0.99 case is
    // the hour leading into the peak, where the solve above refuses to divide.
    range = today.max - today.min;
  }

  // Hour-by-hour projected temps for the rest of today (the today chart's dotted
  // line): the solved range mapped through the average daily shape. A pure shape,
  // deliberately un-pinned — the chart anchors it to wherever its observed line
  // ends, so what this carries is WHEN the peak comes and how the evening falls.
  if (range != null) {
    out.projCurve = profile.map((f, h) =>
      f == null || h < nowHour ? null : Math.round((today.min + range * f) * 10) / 10);
  }
  return out;
}
