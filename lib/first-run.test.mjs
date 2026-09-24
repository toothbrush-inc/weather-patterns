import { describe, expect, it } from "vitest";

import { DEFAULT_LOCATION } from "./constants.mjs";
import { isUntouchedSeedLocation, needsFirstRunSetup } from "./first-run.mjs";

const seed = {
  id: DEFAULT_LOCATION.id,
  name: DEFAULT_LOCATION.name,
  lat: DEFAULT_LOCATION.lat,
  lon: DEFAULT_LOCATION.lon,
  purpleair_sensor_index: "",
};

describe("isUntouchedSeedLocation", () => {
  it("matches the built-in San Francisco placeholder", () => {
    expect(isUntouchedSeedLocation(seed)).toBe(true);
  });

  it("is false once the user picks a sensor or a different point", () => {
    expect(isUntouchedSeedLocation({ ...seed, purpleair_sensor_index: "62489" })).toBe(false);
    expect(isUntouchedSeedLocation({ ...seed, lat: 37.8788, lon: -122.1177 })).toBe(false);
    expect(isUntouchedSeedLocation({ ...seed, id: "abc123" })).toBe(false);
  });
});

describe("needsFirstRunSetup", () => {
  it("is true only when the seed is the sole location", () => {
    expect(needsFirstRunSetup({ locations: [seed] })).toBe(true);
    expect(
      needsFirstRunSetup({
        locations: [seed, { id: "home", name: "Home", lat: 37.88, lon: -122.12 }],
      }),
    ).toBe(false);
    expect(needsFirstRunSetup({ locations: [] })).toBe(false);
  });
});
