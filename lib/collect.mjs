// Shared collection routine: fetch every enabled source for each configured
// location, store the snapshot, and log each source's 1-day-ahead forecast for
// later accuracy scoring. Lives in one place because three callers need it:
//   - scripts/collect.mjs       (standalone CLI for external cron / launchd)
//   - app/api/collect/route.ts  ("↻ Collect now" + on-demand HTTP trigger)
//   - lib/scheduler.mjs         (in-process interval scheduler; see instrumentation.ts)

import fs from "node:fs";
import { getConfig } from "./config.mjs";
import { collectLocation, enabledSourcesFor } from "./sources.mjs";
import { historyFile, insertSnapshot } from "./db.mjs";
import { collectForecasts, forecastsForDate } from "./forecast.mjs";
import { logForecasts } from "./forecastdb.mjs";

// Capture each forecast-capable source's 1-day-ahead (tomorrow) forecast so it
// can later be scored against what actually happens. Best-effort; never blocks a
// snapshot. Returns how many forecast rows were logged.
async function captureForecast(location, madeAt) {
  try {
    const { results, tomorrow } = await collectForecasts(location);
    if (!tomorrow) return 0;
    return logForecasts(location.id, tomorrow, madeAt, forecastsForDate(results, tomorrow));
  } catch {
    return 0;
  }
}

// ---- One collector at a time ----------------------------------------------
// The history and forecast stores are whole-file read-modify-writes, so two
// collections overlapping — the scheduler's tick and a "Collect now" click, or
// the MCP child's collect_now in its own process — could each read the same
// file and the second write drop the first's snapshot. A lock file next to the
// history file serialises every caller, in-process or not. A crashed holder is
// taken over once its lock is older than LOCK_STALE_MS; the takeover renames the
// stale file first so two waiters cannot both think they won.
const LOCK_STALE_MS = 5 * 60_000;
const LOCK_WAIT_MS = 120_000;
const LOCK_POLL_MS = 250;

function lockFile() {
  return `${historyFile()}.lock`;
}

async function acquireLock() {
  const f = lockFile();
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.writeFileSync(f, `${process.pid} ${new Date().toISOString()}\n`, { flag: "wx" });
      return () => {
        try { fs.unlinkSync(f); } catch { /* already gone */ }
      };
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    try {
      if (Date.now() - fs.statSync(f).mtimeMs > LOCK_STALE_MS) {
        const stale = `${f}.${process.pid}.stale`;
        fs.renameSync(f, stale); // only one waiter wins the rename
        fs.unlinkSync(stale);
        continue;
      }
    } catch (e) {
      if (e.code === "ENOENT") continue; // released (or taken over) meanwhile
      throw e;
    }
    if (Date.now() > deadline) throw new Error("collection lock held too long — another collector is stuck?");
    await new Promise((r) => setTimeout(r, LOCK_POLL_MS));
  }
}

export async function withCollectionLock(fn) {
  const release = await acquireLock();
  try {
    return await fn();
  } finally {
    release();
  }
}

// Collect the given locations (default: every configured one). `only` limits to a
// single location id — callers are responsible for validating it exists. Pass a
// `cfg` whose `locations` is already narrowed (a caller's follows) to collect just
// those. Returns one entry per location with the stored row count, forecasts
// logged, the enabled source list, and the raw per-source results, so the CLI can
// print details while the API route reduces them to a summary.
/** @param {{ only?: string, cfg?: any }} [opts] */
export function runCollection(opts = {}) {
  return withCollectionLock(() => collectAll(opts));
}

async function collectAll({ only, cfg = getConfig() } = {}) {
  const targets = only ? cfg.locations.filter((l) => l.id === only) : cfg.locations;
  const out = [];
  for (const location of targets) {
    const enabled = await enabledSourcesFor(location);
    const { ts, results } = await collectLocation(location);
    const stored = insertSnapshot(ts, location, results);
    const forecastsLogged = await captureForecast(location, ts);
    out.push({
      id: location.id,
      name: location.name,
      lat: location.lat,
      lon: location.lon,
      ts,
      stored,
      forecastsLogged,
      enabled,
      results,
    });
  }
  return out;
}
