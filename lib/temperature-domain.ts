// Series with their own data (such as comparison shading) can override Recharts'
// inferred extent. Supply a shared domain that includes every plotted temperature.
export function temperatureDomain(values: (number | null | undefined)[]): [number, number] {
  const finite = values.filter((value): value is number => value != null && Number.isFinite(value));
  return finite.length ? [Math.min(...finite) - 3, Math.max(...finite) + 3] : [0, 100];
}
