import { NextResponse } from "next/server";
// @ts-ignore - plain ESM lib module
import { reverseGeocode, searchPlaces } from "@/lib/geocode.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// City/place search for the location typeahead, or reverse-geocode for
// "use my location." See lib/geocode.mjs.
//   ?q=lafayette+ca          → { results, attribution }
//   ?lat=37.88&lon=-122.12   → { result, attribution }
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const lat = parseFloat(sp.get("lat") || "");
  const lon = parseFloat(sp.get("lon") || "");
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    try {
      return NextResponse.json(await reverseGeocode(lat, lon));
    } catch (e: any) {
      return NextResponse.json({ error: String(e?.message || e), result: null }, { status: 502 });
    }
  }

  const q = (sp.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json({ results: [] });
  try {
    return NextResponse.json(await searchPlaces(q));
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e), results: [] }, { status: 502 });
  }
}
