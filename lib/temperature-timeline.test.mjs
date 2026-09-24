import { describe, it, expect } from 'vitest';
import { temperatureTimeline, timelineX, interpolateHour, withLatestReading } from './temperature-timeline';
const empty = () => Array(24).fill(null);
describe('three-day temperature timeline', () => {
  it('places coarse outer days around 24 hourly points for today', () => {
    const hours = Array.from({ length: 24 }, (_, h) => h);
    const rows = temperatureTimeline(hours, hours, hours, hours);
    expect(rows).toHaveLength(40);
    expect(rows[0]).toMatchObject({ x: 0.5, yesterday: 1, samples: 3 });
    expect(rows[8]).toMatchObject({ x: 12, actual: 0, forecast: 0 });
    expect(rows[31]).toMatchObject({ x: 58, actual: 23 });
    expect(rows[32]).toMatchObject({ x: 60.5, tomorrow: 1 });
    expect(rows[39]).toMatchObject({ x: 71, tomorrow: 22 });
  });
  it('preserves empty intervals and reports partial interval coverage', () => {
    const yesterday = empty(); yesterday[0] = 60; yesterday[2] = 66; yesterday[6] = 0;
    const rows = temperatureTimeline(yesterday, empty(), empty(), empty());
    expect(rows[0]).toMatchObject({ yesterday: 63, samples: 2 });
    expect(rows[1]).toMatchObject({ yesterday: null, samples: 0 });
    expect(rows[2]).toMatchObject({ yesterday: 0, samples: 1 });
    expect(rows[8]).toMatchObject({ actual: null, forecast: null });
    expect(rows[32].tomorrow).toBeNull();
  });
});

it("allocates two-thirds of the chart to today and aligns fractional current times", () => {
  expect([timelineX(0, 0), timelineX(0, 24), timelineX(1, 0), timelineX(1, 24), timelineX(2, 0), timelineX(2, 24)]).toEqual([0, 12, 12, 60, 60, 72]);
  expect(timelineX(1, 6.25)).toBe(24.5);
});

describe("today's latest reading as the end of the observed line", () => {
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const forecast = hours.map((h) => 60 + h); // 60° at midnight, +1°/h
  const actual = empty(); actual[9] = 65; actual[10] = 67; actual[11] = 69;
  const rows = () => temperatureTimeline(empty(), actual, forecast, empty());
  it('interpolates an hourly series at a fractional hour and refuses to bridge a gap', () => {
    expect(interpolateHour(forecast, 11)).toBe(71);
    expect(interpolateHour(forecast, 11.5)).toBe(71.5);
    expect(interpolateHour([70, null], 0.5)).toBeNull();
    expect(interpolateHour([null, 70], 0.5)).toBeNull();
  });
  it('adds an 11:28 reading between the 11am and 12pm rows, with the forecast at that minute', () => {
    const out = withLatestReading(rows(), { hour: 11 + 28 / 60, temp: 69 }, (h) => ({ forecast: interpolateHour(forecast, h) }));
    expect(out).toHaveLength(41);
    const i = out.findIndex((r) => r.latest);
    expect(out[i - 1]).toMatchObject({ x: timelineX(1, 11), actual: 69 });
    expect(out[i]).toMatchObject({ x: timelineX(1, 11 + 28 / 60), day: 1, startHour: 11, actual: 69, forecast: 71.5, samples: 1, latest: true });
    expect(out[i + 1]).toMatchObject({ x: timelineX(1, 12), actual: null });
    expect(out.every((r, k) => k === 0 || r.x > out[k - 1].x)).toBe(true);
  });
  it('adds nothing for a reading on the hour, a missing reading, or a bad hour', () => {
    expect(withLatestReading(rows(), { hour: 11, temp: 69 }, () => ({}))).toHaveLength(40);
    expect(withLatestReading(rows(), null, () => ({}))).toHaveLength(40);
    expect(withLatestReading(rows(), { hour: 24, temp: 69 }, () => ({}))).toHaveLength(40);
  });
  it('keeps a late-evening reading inside today, ahead of the tomorrow rows', () => {
    const out = withLatestReading(rows(), { hour: 23.5, temp: 60 }, () => ({}));
    const i = out.findIndex((r) => r.latest);
    expect(out[i]).toMatchObject({ x: 59, day: 1, startHour: 23, actual: 60 });
    expect(out[i - 1].x).toBe(58);
    expect(out[i + 1]).toMatchObject({ x: 60.5, day: 2 });
  });
});
