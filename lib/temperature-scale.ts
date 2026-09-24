import { TEMP_BANDS } from "./constants.mjs";

// The comparison chart's plain-language temperature scale. Band floors become
// the y-axis ticks, so the horizontal grid lines are the band edges, and the
// bands visible inside the current domain are named down the right-hand axis.

export type TemperatureBand = { label: string; floor: number; ceiling: number };
export type VisibleBand = TemperatureBand & { from: number; to: number; mid: number };

// Degrees of a band that must be on-chart before it earns a label; a sliver at
// the top or bottom of the plot is left unnamed rather than squeezed on the edge.
export const MIN_VISIBLE_SPAN = 5;

const bands: TemperatureBand[] = [...TEMP_BANDS]
  .sort((a, b) => b.floor - a.floor)
  .map((band, index, sorted) => ({ ...band, ceiling: index === 0 ? Infinity : sorted[index - 1].floor }));

export function bandFor(temp: number): TemperatureBand {
  return bands.find(band => temp >= band.floor) ?? bands[bands.length - 1];
}

// Band edges strictly inside the domain. A domain narrow enough to hold fewer than
// two edges falls back to a 5° grid so the axis is never bare.
export function temperatureTicks([low, high]: [number, number]): number[] {
  const edges = bands.map(band => band.floor).filter(floor => Number.isFinite(floor) && floor > low && floor < high).sort((a, b) => a - b);
  if (edges.length >= 2) return edges;
  const ticks: number[] = [];
  for (let value = Math.ceil(low / 5) * 5; value < high; value += 5) if (value > low) ticks.push(value);
  return ticks;
}

export function visibleBands([low, high]: [number, number]): VisibleBand[] {
  return bands
    .map(band => ({ ...band, from: Math.max(band.floor, low), to: Math.min(band.ceiling, high) }))
    .filter(band => band.to - band.from >= MIN_VISIBLE_SPAN)
    .map(band => ({ ...band, mid: (band.from + band.to) / 2 }))
    .sort((a, b) => a.floor - b.floor);
}

// Widen a domain so the band holding `temp` (the current reading) shows at least
// MIN_VISIBLE_SPAN degrees. Otherwise a reading a degree or two inside a band at
// the plot edge would fall in an unlabelled sliver and lose its highlight.
export function domainShowingBand([low, high]: [number, number], temp: number | null | undefined): [number, number] {
  if (temp == null || !Number.isFinite(temp)) return [low, high];
  let lo = Math.min(low, temp), hi = Math.max(high, temp);
  const band = bandFor(temp);
  const shortfall = MIN_VISIBLE_SPAN - (Math.min(band.ceiling, hi) - Math.max(band.floor, lo));
  if (shortfall <= 0) return [lo, hi];
  // The slice is short because one band edge cuts the plot; grow toward the other edge.
  if (band.ceiling > hi) hi += shortfall; else lo -= shortfall;
  return [lo, hi];
}
