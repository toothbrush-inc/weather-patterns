import { describe, expect, it } from "vitest";
import { temperatureBands } from "./temperature-bands";

describe("temperature comparison shading", () => {
  it("splits warm and cool shading at the exact crossing", () => {
    expect(temperatureBands([
      { x: 24, actual: 74, forecast: 70 },
      { x: 25, actual: 68, forecast: 72 },
    ])).toEqual([
      { x: 24, warm: [70, 74], cool: [70, 70] },
      { x: 24.5, warm: [71, 71], cool: [71, 71] },
      { x: 25, warm: [72, 72], cool: [68, 72] },
    ]);
  });
  it("preserves missing observations and forecasts as gaps", () => {
    expect(temperatureBands([
      { x: 24, actual: null, forecast: 70 },
      { x: 25, actual: 68, forecast: null },
    ])).toEqual([
      { x: 24, warm: null, cool: null },
      { x: 25, warm: null, cool: null },
    ]);
  });
});
