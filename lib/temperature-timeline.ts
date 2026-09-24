// Today gets two-thirds of the plot; each outer day gets one-sixth.
export function timelineX(day: number, hour: number) {
  return day === 0 ? hour / 2 : day === 1 ? 12 + hour * 2 : 60 + hour / 2;
}

export type TimelinePoint = {
  x: number;
  day: number;
  startHour: number;
  endHour: number;
  samples: number;
  yesterday: number | null;
  actual: number | null;
  forecast: number | null;
  tomorrow: number | null;
  // Set on the extra point carrying today's latest reading (see withLatestReading).
  latest?: boolean;
};

// Outer days use three-hour means at each interval's midpoint. Empty intervals
// remain explicit nulls so the chart never connects across missing periods.
export function temperatureTimeline(yesterday: (number | null)[], actual: (number | null)[], forecast: (number | null)[], tomorrow: (number | null)[]): TimelinePoint[] {
  const rows: TimelinePoint[] = [];
  for (let day = 0; day < 3; day++) {
    const step = day === 1 ? 1 : 3;
    for (let hour = 0; hour < 24; hour += step) {
      const values = (day === 0 ? yesterday : day === 2 ? tomorrow : actual).slice(hour, hour + step).filter((v): v is number => v != null && Number.isFinite(v));
      const mean = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length * 10) / 10 : null;
      rows.push({ x: timelineX(day, hour + (step - 1) / 2), day, startHour: hour, endHour: hour + step - 1, samples: values.length,
        yesterday: day === 0 ? mean : null, actual: day === 1 ? actual[hour] ?? null : null,
        forecast: day === 1 ? forecast[hour] ?? null : null, tomorrow: day === 2 ? mean : null });
    }
  }
  return rows;
}

// The latest observation of the day at its true fractional local hour. Hourly
// buckets plot at the top of the hour, so without this the observed line stops up
// to an hour short of where the reading actually is.
export type LatestReading = { hour: number; temp: number };

// Linear interpolation of an hourly series at a fractional hour; null when either
// neighbouring hour is missing, so nothing is drawn across a gap.
export function interpolateHour(values: (number | null)[], hour: number): number | null {
  const h = Math.floor(hour), f = hour - h;
  const a = values[h] ?? null;
  if (a == null) return null;
  if (f === 0) return a;
  const b = values[h + 1] ?? null;
  return b == null ? null : Math.round((a + (b - a) * f) * 10) / 10;
}

// Insert today's latest reading as one more point, in x order, so the observed line
// ends exactly where the "now" marker is drawn. `fill` supplies the other series at
// that fractional hour (forecasts, interpolated) so the observed-vs-forecast shading
// and the tooltip continue to the marker. A reading on the hour already has a row.
export function withLatestReading<T extends TimelinePoint>(rows: T[], latest: LatestReading | null | undefined, fill: (hour: number) => Partial<T>): T[] {
  if (!latest || !Number.isFinite(latest.temp) || latest.hour < 0 || latest.hour >= 24) return rows;
  const x = timelineX(1, latest.hour);
  if (rows.some(r => r.x === x)) return rows;
  const hour = Math.floor(latest.hour);
  const point = { x, day: 1, startHour: hour, endHour: hour, samples: 1, yesterday: null, actual: latest.temp, forecast: null, tomorrow: null, latest: true, ...fill(latest.hour) } as T;
  const at = rows.findIndex(r => r.x > x);
  return at === -1 ? [...rows, point] : [...rows.slice(0, at), point, ...rows.slice(at)];
}
