import { NextResponse } from "next/server";
// @ts-ignore - plain ESM lib modules
import {
  addLocationFor,
  removeLocationFor,
  selectLocationFor,
  updateLocationFor,
} from "@/lib/location-actions.mjs";
// @ts-ignore
import { scopeFor } from "@/lib/scope.mjs";
import { withScope, type Scope } from "@/lib/request-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The caller's view: their followed locations and their active one under the
// platform; the whole shared list on a single-tenant instance.
function state(req: Request, extra: Record<string, unknown> = {}) {
  const { cfg, caller }: Scope = scopeFor(req.headers);
  return NextResponse.json({
    locations: cfg.locations,
    activeLocationId: cfg.activeLocationId,
    caller: caller ? { id: caller.id } : null,
    ...extra,
  });
}

export function GET(req: Request) {
  return withScope(req, () => state(req));
}

// Body: { action: "add"|"update"|"remove"|"select", ...fields }
// With a signed-in caller the rules in lib/location-actions.mjs apply: add
// follows (reusing a pool entry at the same spot), update forks an entry that
// others also follow when it moves, remove unfollows and retires only an
// unfollowed entry, select is personal.
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  return withScope(req, ({ caller }) => {
    try {
      let extra: Record<string, unknown> = {};
      switch (body?.action) {
        case "add": {
          const r = addLocationFor(caller, {
            name: body.name,
            lat: body.lat,
            lon: body.lon,
            purpleair_sensor_index: body.purpleair_sensor_index,
          });
          extra = { location: r.location, reused: r.reused };
          break;
        }
        case "update": {
          if (!body.id) throw new Error("update needs an id");
          const r = updateLocationFor(caller, body.id, body);
          extra = { location: r.location, forked: r.forked };
          break;
        }
        case "remove":
          if (!body.id) throw new Error("remove needs an id");
          extra = removeLocationFor(caller, body.id);
          break;
        case "select":
          if (!body.id) throw new Error("select needs an id");
          selectLocationFor(caller, body.id);
          break;
        default:
          return NextResponse.json({ error: "unknown action" }, { status: 400 });
      }
      return state(req, extra);
    } catch (e: any) {
      return NextResponse.json({ error: String(e?.message || e) }, { status: 400 });
    }
  });
}
