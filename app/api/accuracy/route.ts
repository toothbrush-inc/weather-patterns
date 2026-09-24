import { NextResponse } from "next/server";
// @ts-ignore - plain ESM lib modules
import { resolveLocation } from "@/lib/config.mjs";
import { withScope } from "@/lib/request-scope";
// @ts-ignore
import { buildAccuracy } from "@/lib/accuracy.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Forecast-accuracy leaderboard for one location: each source's logged 1-day-ahead
// forecasts scored against its own observed high/low and against PurpleAir. Reads
// the forecast log + observation history and fetches the Open-Meteo archive live.
// ?loc=<id> selects the location; omitted → the caller's active location.
export async function GET(req: Request) {
  const loc = new URL(req.url).searchParams.get("loc") || undefined;
  return withScope(req, async ({ cfg }) => {
    const location = resolveLocation(cfg, loc);
    if (!location) return NextResponse.json({ error: "no location" }, { status: 404 });
    return NextResponse.json(await buildAccuracy(location));
  });
}
