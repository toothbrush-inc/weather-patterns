#!/usr/bin/env node
// Standalone collector for external cron / launchd — no running server needed.
// (Deployed instances instead use the in-process scheduler; see lib/scheduler.mjs
// + instrumentation.ts. This script remains for local/manual runs and setups that
// prefer an external scheduler.) Run:
//   node --env-file=.env.local scripts/collect.mjs   (or: npm run collect)

import { getConfig } from "../lib/config.mjs";
import { runCollection } from "../lib/collect.mjs";

const cfg = getConfig();
console.log(`Collecting ${cfg.locations.length} location(s). DB: ${process.env.WEATHER_DB || "history.json"}`);

const collected = await runCollection({ cfg });
for (const loc of collected) {
  console.log(`\n${loc.name} (${loc.lat},${loc.lon}) — sources: ${loc.enabled.join(", ")}`);
  for (const [src, d] of Object.entries(loc.results)) {
    if (d.status === "ok") {
      const where = d.place || (d.lat != null && d.lon != null ? `${d.lat},${d.lon}` : "—");
      console.log(`  [ok]   ${src.padEnd(20)} temp ${d.temp_f}°F  hum ${d.humidity}%  AQI ${d.aqi ?? "—"}  @ ${where}`);
    } else {
      console.log(`  [FAIL] ${src.padEnd(20)} ${d.error}`);
    }
  }
  console.log(`  stored snapshot @ ${loc.ts} (${loc.stored} rows), logged ${loc.forecastsLogged} forecast(s)`);
}
