import { NextResponse } from "next/server";
// @ts-ignore - plain ESM lib modules
import { hasProviderSecret } from "@/lib/vault.mjs";
// @ts-ignore
import { findNearbyPurpleAir } from "@/lib/sources.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Nearby recently-reporting OUTDOOR PurpleAir sensors, closest first, so the
// setup card / Locations form can offer a short picker. Uses the account read
// key (server-side only). ?lat=&lon=&limit=
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const lat = parseFloat(sp.get("lat") || "");
  const lon = parseFloat(sp.get("lon") || "");
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "lat and lon are required numbers" }, { status: 400 });
  }

  if (!(await hasProviderSecret("purpleair"))) {
    return NextResponse.json({ error: "no PurpleAir key set — add one under ⚙ Keys" }, { status: 400 });
  }

  const limit = Math.min(8, Math.max(1, parseInt(sp.get("limit") || "5", 10) || 5));
  try {
    const sensors = await findNearbyPurpleAir({ lat, lon }, { limit });
    return NextResponse.json({
      sensors,
      sensor: sensors[0] ?? null, // nearest; kept so older callers still work
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 502 });
  }
}
