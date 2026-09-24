import { describe, expect, it } from "vitest";
import { temperatureDomain } from "./temperature-domain";

describe("shared temperature chart domain", () => {
  it("includes cold observations, later forecast peaks, and yesterday's forecast band", () => {
    expect(temperatureDomain([40, 44.7, 52, 72, 75, 81, 51, 71])).toEqual([37, 84]);
  });
  it("includes high breaches and negative temperatures", () => {
    expect(temperatureDomain([-12, 0, 25, 110])).toEqual([-15, 113]);
  });
  it("ignores missing and invalid temperatures and gives empty charts a safe domain", () => {
    expect(temperatureDomain([null, undefined, NaN, Infinity, -Infinity, 60])).toEqual([57, 63]);
    expect(temperatureDomain([null, NaN])).toEqual([0, 100]);
  });
});
