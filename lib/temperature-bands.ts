type Point = { x: number; actual: number | null; forecast: number | null };

// Insert exact intersections so red and blue areas meet where the curves cross.
// Null pairs remain gaps: a missing observation is never treated as a forecast miss.
export function temperatureBands(points: Point[]) {
  const expanded: Point[] = [];
  points.forEach((point, index) => {
    const previous = points[index - 1];
    if (previous && previous.actual != null && previous.forecast != null && point.actual != null && point.forecast != null) {
      const before = previous.actual - previous.forecast, after = point.actual - point.forecast;
      if (before * after < 0) {
        const fraction = before / (before - after);
        const value = previous.forecast + (point.forecast - previous.forecast) * fraction;
        expanded.push({ x: previous.x + (point.x - previous.x) * fraction, actual: value, forecast: value });
      }
    }
    expanded.push(point);
  });
  return expanded.map(({ x, actual, forecast }) => ({
    x,
    warm: actual == null || forecast == null ? null : [forecast, Math.max(actual, forecast)],
    cool: actual == null || forecast == null ? null : [Math.min(actual, forecast), forecast],
  }));
}
