import { describe, expect, it } from "vitest";

import { withOpenMeteoKey } from "./http.mjs";

describe("withOpenMeteoKey", () => {
  const publicUrl =
    "https://api.open-meteo.com/v1/forecast?latitude=37.89&longitude=-122.12";

  it("leaves the public URL alone when no key is set", () => {
    expect(withOpenMeteoKey(publicUrl, "")).toBe(publicUrl);
    expect(withOpenMeteoKey(publicUrl)).toBe(publicUrl);
  });

  it("moves customer traffic off the public host and never mutates the original URL", () => {
    const keyed = withOpenMeteoKey(publicUrl, "customer-meteo-secret");
    const u = new URL(keyed);
    expect(u.host).toBe("customer-api.open-meteo.com");
    expect(u.searchParams.get("apikey")).toBe("customer-meteo-secret");
    expect(publicUrl).not.toContain("apikey");
    expect(publicUrl).toContain("api.open-meteo.com");
  });
});
