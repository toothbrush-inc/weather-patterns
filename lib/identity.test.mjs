import { describe, expect, it } from "vitest";

import { callerFromHeaders, identityEnabled, userSlug } from "./identity.mjs";

describe("userSlug", () => {
  it("flattens an email the way the gateway does", () => {
    expect(userSlug("alice@example.com")).toBe("alice_at_example_com");
    expect(userSlug("  First.Last+tag@Example.org ")).toBe("first_last_tag_at_example_org");
  });
  it("is null when nothing usable survives", () => {
    expect(userSlug("")).toBeNull();
    expect(userSlug("!!!")).toBeNull();
    expect(userSlug(undefined)).toBeNull();
  });
});

describe("callerFromHeaders", () => {
  it("is anonymous when no identity header is configured", () => {
    const env = {};
    expect(identityEnabled(env)).toBe(false);
    expect(callerFromHeaders(new Headers({ "x-forwarded-user": "a@b.c" }), env)).toBeNull();
  });
  it("reads the configured header, case-insensitively", () => {
    const env = { WEATHER_IDENTITY_HEADER: "X-Forwarded-User" };
    expect(identityEnabled(env)).toBe(true);
    const caller = callerFromHeaders(new Headers({ "x-forwarded-user": "Alice@Example.com" }), env);
    expect(caller).toEqual({ id: "alice_at_example_com", email: "alice@example.com" });
  });
  it("treats a missing or empty header as no caller (proxy.ts refuses these)", () => {
    const env = { WEATHER_IDENTITY_HEADER: "X-Forwarded-User" };
    expect(callerFromHeaders(new Headers(), env)).toBeNull();
    expect(callerFromHeaders(new Headers({ "x-forwarded-user": "   " }), env)).toBeNull();
  });
});
