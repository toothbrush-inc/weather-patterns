"use client";

import { useWeatherNow } from "./WeatherClock";

type Hour = {
  hour: number;
  temp_f: number | null;
  precip_prob: number | null;
  wind_mph: number | null;
  conditions?: string | null;
  is_day?: boolean | null;
};
type Day = { date: string; hours: Hour[] };

export default function HourlyForecast({ today, tomorrow, utcOffsetSeconds, loading, iconFor }: {
  today?: Day | null;
  tomorrow?: Day | null;
  utcOffsetSeconds?: number | null;
  loading: boolean;
  iconFor: (conditions?: string | null, precipProb?: number | null) => string;
}) {
  const now = useWeatherNow();

  // Compare local date/hour keys, including across midnight. Never show expired
  // forecast hours as "Now" when a page has stayed open overnight.
  const local = new Date(now + (utcOffsetSeconds ?? 0) * 1000);
  const date = local.toISOString().slice(0, 10);
  const hour = local.getUTCHours();
  const start = `${date}T${String(hour).padStart(2, "0")}`;
  const rows = [today, tomorrow].flatMap((day) => day ? day.hours.map((h) => ({
    ...h, date: day.date, key: `${day.date}T${String(h.hour).padStart(2, "0")}`,
  })) : []).filter((h) => h.key >= start).slice(0, 24);
  const available = rows.some((h) => h.temp_f != null || h.precip_prob != null || h.wind_mph != null);

  return (
    <section className="panel hourly-forecast" aria-labelledby="hourly-heading" aria-busy={loading}>
      <div className="hourly-heading">
        <h2 id="hourly-heading">Next 24 hours</h2>
        <span>Local time · °F</span>
      </div>
      {loading ? <p className="note" role="status">Loading hourly forecast…</p> : !available ? (
        <p className="note">Hourly forecast unavailable right now. Try refreshing in a moment.</p>
      ) : (
        <>
          <div className="hourly-scroll" tabIndex={0} role="region" aria-label="Hourly forecast; scroll horizontally for later hours">
            <ol className="hourly-list">
              {rows.map((h) => {
                const current = h.key === start;
                const condition = h.conditions ?? "Conditions unavailable";
                const icon = h.conditions ? iconFor(h.conditions, h.precip_prob) : "—";
                const nightIcon = h.is_day === false && /clear|sunny/i.test(condition) && icon === "☀️" ? "🌙" : icon;
                return (
                  <li className="hourly-card" key={h.key} data-current={current || undefined}>
                    <span className="hourly-day">{h.date === date ? "Today" : "Tomorrow"}</span>
                    <time dateTime={`${h.key}:00`}>{current ? "Now" : `${h.hour % 12 || 12}${h.hour >= 12 ? "pm" : "am"}`}</time>
                    <span className="hourly-icon" role="img" aria-label={condition} title={condition}>{nightIcon}</span>
                    <strong className="hourly-temp">{h.temp_f == null ? "—" : `${Math.round(h.temp_f)}°`}</strong>
                    <span className="hourly-rain">Rain {h.precip_prob == null ? "—" : `${Math.round(h.precip_prob)}%`}</span>
                    <span className="hourly-wind">{h.wind_mph == null ? "Wind —" : `${Math.round(h.wind_mph)} mph wind`}</span>
                  </li>
                );
              })}
            </ol>
          </div>
          <p className="hourly-foot">Scroll for later hours → · Hourly temperatures are source forecasts, not locally adjusted. The local adjustment above applies to today’s high and low. Rain and wind show the higher available source estimate.</p>
        </>
      )}
    </section>
  );
}
