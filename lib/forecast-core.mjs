// Pure forecast normalization shared by live providers and scenarios.
// Reduce per-source byDate maps to { source: { high_f, low_f, conditions, precip_*, source_url, status } }
// for one date — the shape the dashboard, MCP, and the forecast logger consume.
export function forecastsForDate(results, date) {
  const out = {};
  for (const [k, v] of Object.entries(results)) {
    if (v.status !== "ok") { out[k] = { status: "error", error: v.error }; continue; }
    const d = (date && v.byDate?.[date]) || {};
    out[k] = {
      high_f: d.high_f ?? null,
      low_f: d.low_f ?? null,
      conditions: d.conditions ?? null,
      precip_prob: d.precip_prob ?? null,
      precip_in: d.precip_in ?? null,
      source_url: v.source_url,
      status: "ok",
    };
  }
  return out;
}

// Merge per-source byHour maps into one 24-row day for a date: consensus temp
// (mean across sources, the chart's line) plus the risk fields taken as the max
// across sources — for "should I worry today?" the more pessimistic source is
// the safer read. `by` keeps each source's temp for the tooltip.
export function hourlyForDate(results, date) {
  const hours = [];
  for (let h = 0; h < 24; h++) {
    const by = {};
    const temps = [], probs = [], winds = [], gusts = [];
    let precipIn = null;
    let conditions = null, isDay = null;
    for (const [key, v] of Object.entries(results)) {
      const cell = v.status === "ok" && date ? v.byHour?.[date]?.[h] : null;
      if (!cell) continue;
      conditions ??= cell.conditions ?? null;
      isDay ??= cell.is_day ?? null;
      if (cell.temp_f != null) { by[key] = cell.temp_f; temps.push(cell.temp_f); }
      if (cell.precip_prob != null) probs.push(cell.precip_prob);
      if (cell.wind_mph != null) winds.push(cell.wind_mph);
      if (cell.gust_mph != null) gusts.push(cell.gust_mph);
      if (cell.precip_in != null) precipIn = Math.max(precipIn ?? 0, cell.precip_in);
    }
    hours.push({
      hour: h,
      temp_f: temps.length ? Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 10) / 10 : null,
      by,
      precip_prob: probs.length ? Math.max(...probs) : null,
      precip_in: precipIn,
      wind_mph: winds.length ? Math.max(...winds) : null,
      gust_mph: gusts.length ? Math.max(...gusts) : null,
      conditions,
      is_day: isDay,
    });
  }
  return { date, hours };
}

// Average + spread across the ok forecasts, per numeric field. Conditions stay
// per-source — they aren't a number we can average.
export function forecastConsensus(forecasts) {
  const pick = (field) =>
    Object.values(forecasts)
      .filter((r) => r.status === "ok" && r[field] != null)
      .map((r) => r[field]);
  const summarize = (vals, whole = true) => ({
    value: vals.length
      ? whole
        ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
        : Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100
      : null,
    spread: vals.length >= 2 ? Math.max(...vals) - Math.min(...vals) : null,
  });
  const high = summarize(pick("high_f"));
  const low = summarize(pick("low_f"));
  const precip = summarize(pick("precip_prob"));
  const inches = summarize(pick("precip_in"), false);
  const conditions = pick("conditions");
  return {
    high_f: high.value,
    low_f: low.value,
    high_spread: high.spread,
    low_spread: low.spread,
    precip_prob: precip.value,
    precip_in: inches.value,
    conditions: conditions[0] ?? null,
  };
}
