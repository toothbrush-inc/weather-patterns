import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import Dashboard from "./Dashboard";
import { buildScenario } from "../lib/scenarios.mjs";
import { adjustedDailyRange } from "../lib/forecast-adjustment";

// The hero's High/Low and the day cards must be the same bias-adjusted numbers:
// the daily consensus shifted by the high and low errors, not the hourly curve's
// extremes. Assert on the rendered page, where both come together.
const card = (html, label) => {
  const m = html.match(new RegExp(`tc-day-title">${label}<span>[^<]*</span></span><strong>(-?\\d+)° – (-?\\d+)°`));
  return m ? { low: Number(m[1]), high: Number(m[2]) } : null;
};
const hero = (html) => {
  const m = html.match(/High (-?\d+)°<\/strong><span>Low (-?\d+)°/);
  return m ? { high: Number(m[1]), low: Number(m[2]) } : null;
};

describe("day cards reflect the bias-adjusted forecast", () => {
  for (const id of ["cooler", "warmer", "residual", "on-track"]) {
    it(`today's card matches the hero in the ${id} scenario`, () => {
      const html = renderToStaticMarkup(React.createElement(Dashboard, { scenario: buildScenario(id) }));
      expect(hero(html)).not.toBeNull();
      expect(card(html, "Today")).toEqual(hero(html));
    });
  }
  it("tomorrow's card is tomorrow's consensus shifted by the high and low biases", () => {
    const scenario = buildScenario("cooler");
    const html = renderToStaticMarkup(React.createElement(Dashboard, { scenario }));
    const want = adjustedDailyRange(scenario.forecast.tomorrow.consensus, scenario.accuracy);
    expect(want).not.toBeNull();
    expect(card(html, "Tomorrow")).toEqual({ low: want.low, high: want.high });
    // And it is not the unshifted source forecast.
    expect(want.high).not.toBe(scenario.forecast.tomorrow.consensus.high_f);
  });
  it("outlook cards follow tomorrow, out to 10 days ahead, each shifted by the biases", () => {
    const scenario = buildScenario("cooler");
    const html = renderToStaticMarkup(React.createElement(Dashboard, { scenario }));
    const outlook = scenario.forecast.outlook;
    expect(outlook).toHaveLength(9);
    const titles = [...html.matchAll(/tc-day-title">([^<]+)<span>/g)].map((m) => m[1]);
    expect(titles.slice(0, 3)).toEqual(["Yesterday", "Today", "Tomorrow"]);
    expect(titles).toHaveLength(12);
    for (const day of outlook) {
      const label = new Date(`${day.date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" });
      const want = adjustedDailyRange(day.consensus, scenario.accuracy);
      expect(html).toContain(`tc-day-title">${label}<span>`);
      expect(html).toContain(`${want.low}° – ${want.high}°`);
    }
    // Past weather.gov's week only Open-Meteo forecasts, and the card says so.
    expect(html.match(/tc-day-coverage">1 source</g)).toHaveLength(outlook.filter((d) => d.sources === 1).length);
  });
});
