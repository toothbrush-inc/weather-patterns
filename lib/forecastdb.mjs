// Forecast log — the 1-day-ahead forecasts we capture so we can later score them
// against what actually happened. Separate from the observation history (db.mjs)
// because a forecast is a *prediction made on a date for a different date*.
//
// One row per (loc_id, source, target_date) — upserted, so as a day's forecast
// for tomorrow is re-fetched it refreshes in place; once that day passes the row
// freezes as the 1-day-ahead forecast. made_at records when it was last captured.
// Plain JSON, atomic write, zero native deps (same contract as db.mjs).

import fs from "node:fs";
import path from "node:path";

function file() {
  return process.env.WEATHER_FORECASTS || path.join(process.cwd(), "forecasts.json");
}

function readAll() {
  try {
    const arr = JSON.parse(fs.readFileSync(file(), "utf8"));
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}

function writeAll(rows) {
  const f = file();
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rows));
  fs.renameSync(tmp, f); // atomic replace
}

// Upsert a forecast for (loc_id, source, target_date). `forecasts` is the
// { source: { high_f, low_f } } map for the target day.
export function logForecasts(locId, targetDate, madeAt, forecasts) {
  const rows = readAll();
  let changed = 0;
  for (const [source, f] of Object.entries(forecasts)) {
    if (f.status && f.status !== "ok") continue;
    if (f.high_f == null && f.low_f == null) continue;
    const i = rows.findIndex(
      (r) => r.loc_id === locId && r.source === source && r.target_date === targetDate,
    );
    const row = {
      loc_id: locId,
      source,
      target_date: targetDate,
      made_at: madeAt,
      high_f: f.high_f ?? null,
      low_f: f.low_f ?? null,
    };
    if (i >= 0) rows[i] = row;
    else rows.push(row);
    changed += 1;
  }
  if (changed) writeAll(rows);
  return changed;
}

export function getForecasts(locId) {
  return readAll().filter((r) => r.loc_id === locId);
}
