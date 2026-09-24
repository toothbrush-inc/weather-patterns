import { NextResponse } from "next/server";
// @ts-ignore - plain ESM lib modules
import { getKeyStatusViews, putProviderSecret } from "@/lib/vault.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Global account keys. Secrets never go back to the client: GET reports only
// whether a key is set, a masked preview, and where it resolved from
// (vault, saved settings.json, or environment). PurpleAir sensor indexes live
// on locations, not here. Writes go to the shared vault.

async function state() {
  const views: any = await getKeyStatusViews();
  return NextResponse.json({
    purpleair: { read_key: views.purpleair },
    open_meteo: { api_key: views.open_meteo },
  });
}

export async function GET() {
  return state();
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  try {
    if (body?.purpleair && "read_key" in body.purpleair) {
      await putProviderSecret("purpleair", body.purpleair.read_key);
    }
    if (body?.open_meteo && "api_key" in body.open_meteo) {
      await putProviderSecret("open_meteo", body.open_meteo.api_key);
    }
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 400 });
  }
  return GET();
}
