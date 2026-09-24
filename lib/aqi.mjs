// US EPA AQI from PM2.5 (µg/m³). 24h breakpoints applied to the instantaneous value.

const BREAKPOINTS = [
  [0.0, 12.0, 0, 50],
  [12.1, 35.4, 51, 100],
  [35.5, 55.4, 101, 150],
  [55.5, 150.4, 151, 200],
  [150.5, 250.4, 201, 300],
  [250.5, 350.4, 301, 400],
  [350.5, 500.4, 401, 500],
];

export function pm25ToAqi(pm) {
  if (pm === null || pm === undefined || Number.isNaN(pm)) return null;
  const v = Math.max(0, Math.round(pm * 10) / 10);
  for (const [clo, chi, ilo, ihi] of BREAKPOINTS) {
    if (v >= clo && v <= chi) {
      return Math.round(((ihi - ilo) / (chi - clo)) * (v - clo) + ilo);
    }
  }
  return 500;
}
