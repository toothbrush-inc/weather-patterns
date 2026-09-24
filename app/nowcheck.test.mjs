import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import Dashboard from "./Dashboard";
import { buildScenario } from "../lib/scenarios.mjs";

// The reality check reads its numbers off several sources at once — today's running
// high/low, the current reading, the learned bias — and the bugs live in how they are
// combined, not in any one of them. So assert on the rendered card rather than on the
// pieces: the mixed-frame comparison this guards against was invisible until the whole
// thing was drawn. `nowcheck` is the hero card; the slice ends where the next panel starts.
const nowcheck = (id) => {
  const html = renderToStaticMarkup(React.createElement(Dashboard, { scenario: buildScenario(id) }));
  const card = html.match(/<div class="nowcheck"[\s\S]*?(?=<div class="panel|<section)/);
  return (card ? card[0] : html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
};

describe("rendered forecast reality check", () => {
  it("reads a sensor sitting on its corrected forecast as on track", () => {
    // 6°F-warm sensor at 81° against an 84° corrected high. Compared against the raw
    // 78° the sources published, this said "Warmer than expected" every afternoon.
    expect(nowcheck("warmer")).toContain("On track with the forecast");
    expect(nowcheck("warmer")).toContain("Hi 84°");
    expect(nowcheck("cooler")).toContain("On track with the forecast");
    expect(nowcheck("cooler")).toContain("Lo 52°");
  });
  it("still calls a real excursion a miss", () => {
    expect(nowcheck("high-breach")).toContain("Warmer than expected");
    expect(nowcheck("low-breach")).toContain("Colder than expected");
  });
  it("marks corrected bounds and leaves uncorrected ones unmarked", () => {
    expect(nowcheck("warmer")).toContain("Forecast*");
    expect(nowcheck("on-track")).toContain("Forecast So far"); // no asterisk in the header
    expect(nowcheck("on-track")).not.toContain("Forecast*");
  });
  it("corrects each end by its own bias", () => {
    // Warm on highs, true on lows: the high moves 8°, the low does not move at all.
    const card = nowcheck("asymmetric");
    expect(card).toContain("Hi 86°");
    expect(card).toContain("Lo 58°");
  });
  it("does not compare a stale sensor reading against sensor-corrected bounds", () => {
    // The sensor last reported yesterday afternoon, so today's running high/low came off
    // the sources. Correcting the bounds into the sensor's frame here — or folding that
    // stale reading into a source-frame high/low — reads as a breach that never happened.
    const card = nowcheck("sparse-sensor");
    expect(card).toContain("On track with the forecast");
    expect(card).not.toContain("Forecast*");
    expect(card).toContain("Hi 78°");
  });
});
