import { NextResponse } from "next/server";
// @ts-ignore - plain ESM lib modules
import { collectLocation } from "@/lib/sources.mjs";
// @ts-ignore
import { haversineMiles, roundMiles } from "@/lib/geo.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "How far is each weather station from this exact spot?" Does a live, throwaway
// collection for the given point (NOT stored) and reports, per source, the actual
// station/sensor/grid cell it read from and its great-circle distance. Used by the
// Locations panel so you can enter a street address and see the distances before
// committing. ?lat=&lon=&purpleair_sensor_index=
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const lat = parseFloat(sp.get("lat") || "");
  const lon = parseFloat(sp.get("lon") || "");
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "lat and lon are required numbers" }, { status: 400 });
  }
  const location = {
    id: "preview",
    name: sp.get("name") || "this location",
    lat,
    lon,
    purpleair_sensor_index: (sp.get("purpleair_sensor_index") || "").trim(),
  };

  const { results } = await collectLocation(location);
  const stations = Object.entries(results).map(([source, d]: any) => ({
    source,
    status: d.status,
    error: d.error ?? null,
    place: d.place ?? null,
    lat: d.lat ?? null,
    lon: d.lon ?? null,
    source_url: d.source_url ?? null,
    distance_mi: roundMiles(haversineMiles(location, { lat: d.lat, lon: d.lon })),
  }));
  return NextResponse.json({ location: { lat, lon }, stations });
}
