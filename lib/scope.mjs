// One request's view of the world: the shared pool narrowed to the caller when
// the platform says who they are, the whole pool when the instance is anonymous.
// Every API route goes through here so the two modes differ in exactly one place.

import { getConfig } from "./config.mjs";
import { callerFromHeaders, identityEnabled } from "./identity.mjs";
import { userConfig } from "./users.mjs";

/**
 * @returns {{ denied: boolean, caller: {id:string,email:string}|null, pool: any, cfg: any }}
 *   denied  — identity is switched on but the request carries no caller. proxy.ts
 *             already 401s these; this is the belt to its braces.
 *   pool    — the shared config (every location the collector runs)
 *   cfg     — what this caller may see: their follows, or the pool when anonymous
 */
export function scopeFor(headers) {
  const caller = callerFromHeaders(headers);
  if (!caller && identityEnabled()) return { denied: true, caller: null, pool: null, cfg: null };
  const pool = getConfig();
  return { denied: false, caller, pool, cfg: caller ? userConfig(pool, caller.id) : pool };
}
