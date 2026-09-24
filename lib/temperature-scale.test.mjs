import { describe, expect, it } from "vitest";
import { bandFor, domainShowingBand, temperatureTicks, visibleBands } from "./temperature-scale";

describe("plain-language temperature scale", () => {
  it("assigns a temperature to the highest band floor it reaches", () => {
    expect(bandFor(104).label).toBe("Very hot");
    expect(bandFor(100).label).toBe("Very hot");
    expect(bandFor(99.9).label).toBe("Hot");
    expect(bandFor(75).label).toBe("Mild");
    expect(bandFor(40).label).toBe("Cold");
    expect(bandFor(39.5).label).toBe("Very cold");
    expect(bandFor(32).label).toBe("Very cold");
    expect(bandFor(31).label).toBe("Freezing");
    expect(bandFor(-20).label).toBe("Freezing");
  });
  it("uses band edges inside the domain as ticks", () => {
    expect(temperatureTicks([55, 84])).toEqual([60, 70, 80]);
    expect(temperatureTicks([28, 45])).toEqual([32, 40]);
  });
  it("falls back to a 5° grid when the domain holds fewer than two band edges", () => {
    expect(temperatureTicks([71, 79])).toEqual([75]);
    expect(temperatureTicks([66, 79])).toEqual([70, 75]);
  });
  it("names each band visible in the domain, clipped to the plot, with a label midpoint", () => {
    expect(visibleBands([55, 84])).toEqual([
      expect.objectContaining({ label: "Chilly", from: 55, to: 60, mid: 57.5 }),
      expect.objectContaining({ label: "Cool", from: 60, to: 70, mid: 65 }),
      expect.objectContaining({ label: "Mild", from: 70, to: 80, mid: 75 }),
    ]);
  });
  it("leaves slivers narrower than five degrees unlabelled", () => {
    expect(visibleBands([57, 83]).map(b => b.label)).toEqual(["Cool", "Mild"]);
    expect(visibleBands([57, 85]).map(b => b.label)).toEqual(["Cool", "Mild", "Warm"]);
  });
  it("handles the open-ended bands at either extreme", () => {
    expect(visibleBands([95, 113])).toEqual([
      expect.objectContaining({ label: "Hot", from: 95, to: 100 }),
      expect.objectContaining({ label: "Very hot", from: 100, to: 113, mid: 106.5 }),
    ]);
    expect(visibleBands([-15, 36]).map(b => b.label)).toEqual(["Freezing"]);
  });
  it("widens the domain so the current reading's band is always labelled", () => {
    expect(domainShowingBand([57, 83], 82)).toEqual([57, 85]);
    expect(visibleBands(domainShowingBand([57, 83], 82)).map(b => b.label)).toContain("Warm");
    expect(domainShowingBand([67, 88], 68)).toEqual([65, 88]);
    expect(domainShowingBand([57, 85], 82)).toEqual([57, 85]);
    expect(domainShowingBand([57, 83], 75)).toEqual([57, 83]);
  });
  it("brings a reading outside the domain into view with its band", () => {
    expect(domainShowingBand([60, 78], 81)).toEqual([60, 85]);
    expect(domainShowingBand([60, 78], null)).toEqual([60, 78]);
  });
});
