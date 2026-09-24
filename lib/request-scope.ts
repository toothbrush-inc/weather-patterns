import { NextResponse } from "next/server";
// @ts-ignore - plain ESM lib module
import { scopeFor } from "./scope.mjs";

export type Caller = { id: string; email: string };
export type Scope = { caller: Caller | null; pool: any; cfg: any };

// Route wrapper: resolve who is asking and what they may see, or answer 401 when
// identity is on and the trusted header is missing (see lib/identity.mjs).
export async function withScope(
  req: Request,
  fn: (scope: Scope) => Response | Promise<Response>,
): Promise<Response> {
  const scope = scopeFor(req.headers);
  if (scope.denied) {
    return NextResponse.json({ error: "sign in through the platform front door" }, { status: 401 });
  }
  return fn(scope);
}
