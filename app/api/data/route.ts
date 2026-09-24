import { NextResponse } from "next/server";
// @ts-ignore - plain ESM lib module
import { buildPayload } from "@/lib/payload.mjs";
import { withScope } from "@/lib/request-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only: everything the dashboard needs to render one location.
// ?loc=<id> selects the location; omitted → the caller's active one. Under the
// platform the caller sees only the locations they follow (lib/scope.mjs).
export async function GET(req: Request) {
  const loc = new URL(req.url).searchParams.get("loc") || undefined;
  return withScope(req, async (scope) => NextResponse.json(await buildPayload(loc, scope)));
}
