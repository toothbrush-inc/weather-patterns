// Capability-gap ledger (SPEC.md §13). The agent calls request_capability when
// no tool can satisfy the ask; we persist a sanitized intent summary, never the
// raw conversation. Local JSON, same contract as settings/history.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

function file() {
  return process.env.WEATHER_GAPS || path.join(process.cwd(), "gaps.json");
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
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
  fs.renameSync(tmp, f);
}

function clip(v, max = 500) {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
}

export function recordCapabilityGap({ intent, context } = {}) {
  const summary = clip(intent);
  if (!summary) throw new Error("intent is required");
  const row = {
    id: randomUUID().slice(0, 8),
    intent: summary,
    context: clip(context),
    created_at: new Date().toISOString(),
  };
  writeAll(readAll().concat(row));
  return row;
}
