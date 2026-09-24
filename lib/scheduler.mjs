// In-process collection scheduler. Started once at server boot by
// instrumentation.ts (Node runtime only). This is what lets a deployed instance —
// the Docker image, a PaaS service — accumulate history on a schedule with no
// external cron or launchd. The whole "low-maintenance, runs anywhere" goal hangs
// on this: one process serves the dashboard *and* collects.
//
// External collection is still fully supported (scripts/collect.mjs, or
// POST /api/collect from a platform cron). Set COLLECT_INTERVAL_MINUTES=0 to turn
// this off if you'd rather drive collection that way.

import { runCollection } from "./collect.mjs";

let started = false;

function intervalMinutes() {
  const raw = process.env.COLLECT_INTERVAL_MINUTES;
  if (raw != null && raw !== "") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  // Default: collect in production, stay quiet during `next dev` so local
  // development doesn't fire background network calls every half hour. (The
  // README's "viewing vs collecting" split — dev is for viewing.)
  return process.env.NODE_ENV === "production" ? 30 : 0;
}

export function startScheduler() {
  if (started) return; // guard against double-registration on reload
  const minutes = intervalMinutes();
  if (!(minutes > 0)) {
    console.log("[scheduler] disabled (set COLLECT_INTERVAL_MINUTES > 0 to enable)");
    return;
  }
  started = true;

  const tick = async () => {
    try {
      const collected = await runCollection();
      const rows = collected.reduce((n, l) => n + l.stored, 0);
      console.log(`[scheduler] collected ${collected.length} location(s), ${rows} row(s)`);
    } catch (e) {
      console.error(`[scheduler] collection failed: ${e?.message || e}`);
    }
  };

  // First run shortly after boot (let the server settle), then on the interval.
  // unref() so these timers never hold the process open on shutdown.
  setTimeout(tick, 10_000).unref();
  setInterval(tick, minutes * 60_000).unref();
  console.log(`[scheduler] enabled: collecting every ${minutes} min`);
}
