import { describe, it, expect } from 'vitest';
import { adjustedDailyRange, nowVsExpected, NOW_DELTA_MIN, fitCurve, adjustedValue, consensusBiasFor, highComparison, temperatureTrend, adjustmentSummary, forecastCurve, comparableBounds, breachAt, NOWCHECK_TOL } from './forecast-adjustment';
const day = (date, over) => ({ date, paHigh: null, paLow: null, actualHigh: null, actualLow: null, sources: {}, ...over });
const scored = [
  day('2026-09-05', { paHigh: 80, paLow: 55, actualHigh: 73, sources: { om: { forecastHigh: 85, forecastLow: 60 }, nws: { forecastHigh: 81, forecastLow: 58 } } }),
  day('2026-09-06', { paHigh: 70, paLow: 48, actualHigh: 65, sources: { om: { forecastHigh: 74, forecastLow: 52 }, nws: { forecastHigh: 76, forecastLow: 50 } } }),
];
describe('consensus bias', () => {
  it('averages how far the source consensus missed the local sensor', () => {
    expect(consensusBiasFor({ hasPurpleair: true, daily: scored }, 'high')).toEqual({ bias: 4, mae: 4, n: 2 });
    expect(consensusBiasFor({ hasPurpleair: true, daily: scored }, 'low')).toEqual({ bias: 3.5, mae: 3.5, n: 2 });
  });
  it('scores against reporting sources when there is no local sensor', () => {
    expect(consensusBiasFor({ hasPurpleair: false, daily: scored }, 'high')).toEqual({ bias: 10, mae: 10, n: 2 });
  });
  it('excludes the cutoff date and later so a day is never scored against itself', () => {
    expect(consensusBiasFor({ hasPurpleair: true, daily: scored }, 'high', '2026-09-06')).toEqual({ bias: 3, mae: 3, n: 1 });
    expect(consensusBiasFor({ hasPurpleair: true, daily: scored }, 'high', '2026-09-05')).toBeNull();
  });
  it('skips days missing an outcome or a forecast, and reports null when nothing scores', () => {
    const daily = [...scored, day('2026-09-07', { sources: { om: { forecastHigh: 90, forecastLow: 60 } } }), day('2026-09-08', { paHigh: 70 })];
    expect(consensusBiasFor({ hasPurpleair: true, daily }, 'high')).toMatchObject({ n: 2 });
    expect(consensusBiasFor({ hasPurpleair: true, daily: [] }, 'high')).toBeNull();
  });
  it('pools each day\'s high and low for the mean metric, still counting days once', () => {
    const daily = [day('2026-09-05', { paHigh: 80, paLow: 60, sources: { om: { forecastHigh: 86, forecastLow: 62 } } })];
    expect(consensusBiasFor({ hasPurpleair: true, daily }, 'mean')).toMatchObject({ bias: 4, n: 1 });
    expect(consensusBiasFor({ hasPurpleair: true, daily }, 'high')).toMatchObject({ bias: 6, n: 1 });
    expect(consensusBiasFor({ hasPurpleair: true, daily }, 'low')).toMatchObject({ bias: 2, n: 1 });
  });
  it('still scores a day for the mean when only one end is available', () => {
    const daily = [day('2026-09-05', { paHigh: 80, sources: { om: { forecastHigh: 86 } } })];
    expect(consensusBiasFor({ hasPurpleair: true, daily }, 'mean')).toMatchObject({ bias: 6, n: 1 });
  });
  it('keeps mean error signed while mean absolute error stays a magnitude', () => {
    const daily = [
      day('2026-09-05', { paHigh: 80, sources: { om: { forecastHigh: 83 } } }),
      day('2026-09-06', { paHigh: 80, sources: { om: { forecastHigh: 75 } } }),
    ];
    expect(consensusBiasFor({ hasPurpleair: true, daily }, 'high')).toEqual({ bias: -1, mae: 4, n: 2 });
  });
});
describe('adjusted value', () => {
  const bias = (b) => ({ bias: b, mae: Math.abs(b), n: 3 });
  it('subtracts the bias and rounds to a whole degree', () => {
    expect(adjustedValue(79.5, bias(4))).toBe(76);
    expect(adjustedValue(70, bias(-4))).toBe(74);
  });
  it('leaves a value inside the dead-band alone, still rounded for display', () => {
    expect(adjustedValue(79.33333333333333, bias(1.5))).toBe(79);
  });
  it('has nothing to say without a value or a bias', () => {
    expect(adjustedValue(null, bias(4))).toBeNull();
    expect(adjustedValue(70, null)).toBeNull();
  });
});
describe('fitted curve', () => {
  it('lands the warmest hour on the corrected high and the coldest on the corrected low', () => {
    expect(fitCurve([50, 60, 70], { high: 76, low: 50 })).toEqual([50, 63, 76]);
    // The 2026-09-15 case: hourly peak 79.5 under a corrected daily high of 83 and low 56.
    const out = fitCurve([56.5, 60, 79.5], { high: 83, low: 56 });
    expect(Math.max(...out)).toBe(83);
    expect(Math.min(...out)).toBe(56);
  });
  it('ramps between ends when only one was corrected, instead of a pooled shift', () => {
    // +8 at the high, 0 at the low: the low stays, the high moves the full 8.
    expect(fitCurve([50, 70, 90], { high: 98, low: 50 })).toEqual([50, 74, 98]);
  });
  it('shifts to meet the one end it knows', () => {
    expect(fitCurve([50, 60, 70], { high: 76, low: null })).toEqual([56, 66, 76]);
    expect(fitCurve([50, 60, 70], { high: null, low: 46 })).toEqual([46, 56, 66]);
  });
  it('keeps a gap a gap and claims nothing without a range', () => {
    expect(fitCurve([50, null, 70], { high: 76, low: 50 })).toEqual([50, null, 76]);
    expect(fitCurve([50, 60], null)).toEqual([null, null]);
    expect(fitCurve([50, 60], { high: null, low: null })).toEqual([null, null]);
    expect(fitCurve([null, null], { high: 76, low: 50 })).toEqual([null, null]);
  });
  it('shifts rather than stretches a flat day', () => {
    expect(fitCurve([60, 60, 60], { high: 66, low: 56 })).toEqual([66, 66, 66]);
  });
});
describe('high comparison', () => {
  it('names the whole-degree difference between two highs', () => {
    expect(highComparison(85, 80)).toBe('5° hotter');
    expect(highComparison(75, 80)).toBe('5° colder');
    expect(highComparison(85.6, 80)).toBe('6° hotter');
  });
  it('calls a sub-degree difference the same', () => {
    expect(highComparison(80, 80)).toBe('About the same');
    expect(highComparison(80.4, 80)).toBe('About the same');
  });
  it('does not invent a comparison when either high is missing', () => {
    expect(highComparison(null, 80)).toBe('Not enough data');
    expect(highComparison(80, null)).toBe('Not enough data');
  });
});
describe('short-term trend', () => {
  const flat = (v) => Array(48).fill(v);
  const at = (base, over) => Object.entries(over).reduce((a, [h, v]) => (a[h] = v, a), [...base]);
  it('names the direction three hours out', () => {
    expect(temperatureTrend(at(flat(70), { 14: 70, 17: 78 }), 14)).toEqual({ phrase: 'Warming up', delta: 8, hour: 17 });
    expect(temperatureTrend(at(flat(70), { 16: 84, 19: 74 }), 16)).toEqual({ phrase: 'Cooling off', delta: -10, hour: 19 });
  });
  it('treats a move under 2°F as no trend, matching the daily comparisons', () => {
    expect(temperatureTrend(at(flat(70), { 9: 70, 12: 71 }), 9)).toMatchObject({ phrase: 'Holding steady', delta: 1 });
    expect(temperatureTrend(at(flat(70), { 9: 70, 12: 69 }), 9)).toMatchObject({ phrase: 'Holding steady', delta: -1 });
  });
  it('counts a rounded 2°F move as a real trend', () => {
    expect(temperatureTrend(at(flat(70), { 9: 70, 12: 71.6 }), 9)).toMatchObject({ phrase: 'Warming up', delta: 2 });
    expect(temperatureTrend(at(flat(70), { 9: 70, 12: 68 }), 9)).toMatchObject({ phrase: 'Cooling off', delta: -2 });
  });
  it('crosses midnight into tomorrow and reports the local hour it lands on', () => {
    expect(temperatureTrend(at(flat(70), { 23: 64, 26: 58 }), 23)).toEqual({ phrase: 'Cooling off', delta: -6, hour: 2 });
  });
  it('honors a different look-ahead window', () => {
    expect(temperatureTrend(at(flat(70), { 6: 55, 7: 61 }), 6, 1)).toMatchObject({ phrase: 'Warming up', hour: 7 });
  });
  it('stays quiet when either end of the window is missing', () => {
    expect(temperatureTrend(at(flat(70), { 14: null }), 14)).toBeNull();
    expect(temperatureTrend(at(flat(70), { 17: null }), 14)).toBeNull();
    expect(temperatureTrend(Array(24).fill(70), 23)).toBeNull();
  });
});
describe('adjustment summary', () => {
  const bias = (b, n = 12) => ({ bias: b, mae: Math.abs(b), n });
  it('states the shift the reader sees, opposite in sign to the bias', () => {
    expect(adjustmentSummary(bias(6))).toEqual({ n: 12, shift: '6° cooler' });
    expect(adjustmentSummary(bias(-6))).toEqual({ n: 12, shift: '6° warmer' });
  });
  it('reports no shift inside the dead-band, and nothing at all without a bias', () => {
    expect(adjustmentSummary(bias(1.5))).toEqual({ n: 12, shift: null });
    expect(adjustmentSummary(null)).toBeNull();
  });
});
describe('forecast curve', () => {
  const src = [50, 60, 70, 80];
  it('prefers the adjustment and falls back to the source hour by hour', () => {
    expect(forecastCurve(src, [55, null, 75, null])).toEqual([55, 60, 75, 80]);
  });
  it('never drops a point the source had, however thin the history', () => {
    expect(forecastCurve(src, [null, null, null, null])).toEqual(src);
    expect(forecastCurve(src, [])).toEqual(src);
  });
  it('keeps a source gap a gap rather than inventing a value', () => {
    expect(forecastCurve([50, null, 70], [55, 65, 75])).toEqual([55, 65, 75]);
    expect(forecastCurve([50, null, 70], [null, null, null])).toEqual([50, null, 70]);
  });
  it('is the forecast all day: no projection is spliced into the hours still to come', () => {
    expect(forecastCurve(src, [55, 65, 75, 85])).toEqual([55, 65, 75, 85]);
    expect(forecastCurve.length).toBe(2);
  });
});

describe('comparable bounds', () => {
  // A sensor reading 6°F warm than the sources, learned over two days at both ends.
  const warmSensor = {
    hasPurpleair: true,
    daily: [
      day('2026-09-05', { paHigh: 84, paLow: 64, sources: { om: { forecastHigh: 78, forecastLow: 58 } } }),
      day('2026-09-06', { paHigh: 84, paLow: 64, sources: { om: { forecastHigh: 78, forecastLow: 58 } } }),
    ],
  };
  it('restates the bounds in the sensor’s scale, so its offset is not read as a miss', () => {
    expect(comparableBounds(78, 58, warmSensor, 'sensor')).toEqual({ high: 84, low: 64, corrected: true });
  });
  it('corrects each end by its own bias rather than one pooled offset', () => {
    // Warm on highs, true on lows: the pooled mean would move both ends by 4°.
    const asymmetric = { hasPurpleair: true, daily: [
      day('2026-09-05', { paHigh: 86, paLow: 58, sources: { om: { forecastHigh: 78, forecastLow: 58 } } }),
    ] };
    expect(comparableBounds(78, 58, asymmetric, 'sensor')).toEqual({ high: 86, low: 58, corrected: true });
  });
  it('leaves a source-frame reading alone when the bias was learned against the sensor', () => {
    // The sensor has history but went quiet today, so `so far` came off the sources.
    // Shifting by the sensor's offset here would invent the error this exists to remove.
    expect(comparableBounds(78, 58, warmSensor, 'sources')).toEqual({ high: 78, low: 58, corrected: false });
  });
  it('corrects a source-frame reading when there is no sensor to have learned against', () => {
    const noSensor = { hasPurpleair: false, daily: [
      day('2026-09-05', { actualHigh: 84, actualLow: 64, sources: { om: { forecastHigh: 78, forecastLow: 58 } } }),
    ] };
    expect(comparableBounds(78, 58, noSensor, 'sources')).toMatchObject({ high: 84, low: 64 });
    expect(comparableBounds(78, 58, noSensor, 'sensor')).toMatchObject({ high: 78, low: 58 });
  });
  it('reports no correction inside the dead-band or without any history', () => {
    const slight = { hasPurpleair: true, daily: [
      day('2026-09-05', { paHigh: 79, paLow: 59, sources: { om: { forecastHigh: 78, forecastLow: 58 } } }),
    ] };
    expect(comparableBounds(78, 58, slight, 'sensor')).toEqual({ high: 78, low: 58, corrected: false });
    expect(comparableBounds(78, 58, null, 'sensor')).toEqual({ high: 78, low: 58, corrected: false });
    expect(comparableBounds(78, 58, { hasPurpleair: true, daily: [] }, 'sensor')).toEqual({ high: 78, low: 58, corrected: false });
  });
  it('keeps a missing bound missing', () => {
    expect(comparableBounds(null, 58, warmSensor, 'sensor')).toMatchObject({ high: null, low: 64 });
  });
});
describe('forecast breach', () => {
  const bounds = { high: 84, low: 64 };
  it('calls a breach only once reality has passed a bound by more than the slack', () => {
    expect(breachAt(bounds, 84 + NOWCHECK_TOL, 70)).toMatchObject({ highBlown: false });
    expect(breachAt(bounds, 84 + NOWCHECK_TOL + 0.1, 70)).toMatchObject({ highBlown: true });
    expect(breachAt(bounds, 70, 64 - NOWCHECK_TOL)).toMatchObject({ lowBlown: false });
    expect(breachAt(bounds, 70, 64 - NOWCHECK_TOL - 0.1)).toMatchObject({ lowBlown: true });
  });
  it('does not call a breach against a bound or a reading it does not have', () => {
    expect(breachAt({ high: null, low: null }, 200, -200)).toEqual({ highBlown: false, lowBlown: false });
    expect(breachAt(bounds, null, null)).toEqual({ highBlown: false, lowBlown: false });
  });
  it('reads a warm sensor on track against corrected bounds where raw ones cry wolf', () => {
    const observedHigh = 81; // 6°F-warm sensor, exactly on pace for a 78° source forecast
    expect(breachAt({ high: 78, low: 58 }, observedHigh, 70).highBlown).toBe(true);   // raw
    expect(breachAt({ high: 84, low: 64 }, observedHigh, 70).highBlown).toBe(false);  // corrected
  });
});

describe('now vs expected', () => {
  const curve = Array.from({ length: 24 }, (_, h) => 60 + h); // 60° at midnight, +1°/h
  it('says how far the current reading sits from the curve at this minute', () => {
    expect(nowVsExpected(75, curve, 10, 0)).toEqual({ delta: 5, warmer: true });
    expect(nowVsExpected(66, curve, 10, 0)).toEqual({ delta: 4, warmer: false });
  });
  it('interpolates between the surrounding hours', () => {
    // 10:30 sits halfway between 70° and 71°; 74 is 3.5° over, which rounds to 4.
    expect(nowVsExpected(74, curve, 10, 30)).toEqual({ delta: 4, warmer: true });
  });
  it('measures against the forecasters, not a projection fitted to today', () => {
    // A slow morning: the corrected forecast said 63° for this minute and the sensor reads 58°.
    // Fitted so the day peaks at the hero's High (83 + 2.4) and troughs at its Low (60 + 2.4).
    const chart = forecastCurve(curve, fitCurve(curve, { high: 85.4, low: 62.4 }));
    expect(chart[8]).toBe(70.4);
    expect(nowVsExpected(65, chart, 8, 26)).toEqual({ delta: 6, warmer: false });
  });
  it('stays quiet under the minimum and without data', () => {
    expect(NOW_DELTA_MIN).toBe(1);
    expect(nowVsExpected(70.4, curve, 10, 0)).toBeNull();
    expect(nowVsExpected(null, curve, 10, 0)).toBeNull();
    expect(nowVsExpected(70, [], 10, 0)).toBeNull();
  });
  it('holds the last hour flat instead of reading past the day', () => {
    expect(nowVsExpected(86, curve, 23, 30)).toEqual({ delta: 3, warmer: true });
  });
});

describe('adjusted daily range', () => {
  const acc = { hasPurpleair: true, daily: scored }; // high bias 4 (forecast ran warm), low bias 3.5
  it('shifts the high and the low by their own biases', () => {
    expect(adjustedDailyRange({ high_f: 80, low_f: 60 }, acc)).toEqual({ high: 76, low: 57 });
  });
  it('bounds a day underway by what has already been observed', () => {
    expect(adjustedDailyRange({ high_f: 80, low_f: 60 }, acc, { high: 79, low: 55 })).toEqual({ high: 79, low: 55 });
  });
  it('falls back to the raw consensus with nothing scored, and to observations with no forecast', () => {
    expect(adjustedDailyRange({ high_f: 80, low_f: 60 }, null)).toEqual({ high: 80, low: 60 });
    expect(adjustedDailyRange({ high_f: 80, low_f: 60 }, { hasPurpleair: true, daily: [] })).toEqual({ high: 80, low: 60 });
    expect(adjustedDailyRange({ high_f: null, low_f: null }, acc, { high: 71, low: null })).toEqual({ high: 71, low: null });
    expect(adjustedDailyRange({ high_f: null, low_f: null }, acc)).toBeNull();
    expect(adjustedDailyRange(null, acc)).toBeNull();
  });
});
