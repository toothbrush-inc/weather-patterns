import { NextResponse } from "next/server";
// @ts-ignore - plain ESM lib module
import { runCollection } from "@/lib/collect.mjs";
import { withScope } from "@/lib/request-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fetch every enabled source for every location the caller can see, store each
// snapshot, and return what happened per location. Trigger on a schedule (cron)
// to build divergence history, or use the built-in scheduler (lib/scheduler.mjs).
// ?loc=<id> limits collection to a single location. Under the platform a caller
// collects only the locations they follow; the scheduler still covers the whole
// pool. Collections are serialised by a lock (lib/collect.mjs), so a click and
// the scheduler's tick cannot drop each other's snapshot.
async function handle(req: Request) {
  const url = new URL(req.url);
  return withScope(req, async ({ cfg, pool }) => {
    if (pool.collectToken && url.searchParams.get("token") !== pool.collectToken) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const only = url.searchParams.get("loc") || undefined;
    if (only && !cfg.locations.some((l: any) => l.id === only)) {
      return NextResponse.json({ error: `unknown location ${only}` }, { status: 404 });
    }

    const collected = await runCollection({ only, cfg });
    const locations = collected.map((l: any) => ({
      id: l.id,
      name: l.name,
      ts: l.ts,
      stored: l.stored,
      forecastsLogged: l.forecastsLogged,
      summary: Object.fromEntries(
        Object.entries(l.results).map(([k, v]: any) => [k, v.status === "ok" ? "ok" : v.error]),
      ),
    }));
    return NextResponse.json({ locations });
  });
}

export async function GET(req: Request) {
  return handle(req);
}
export async function POST(req: Request) {
  return handle(req);
}
