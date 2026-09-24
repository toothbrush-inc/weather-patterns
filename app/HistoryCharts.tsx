"use client";

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

type Reading = { ts: string; source: string; status: string } & Record<string, any>;
type Data = {
  sources: string[];
  sourceLabels: Record<string, string>;
  sourceColors: Record<string, string>;
  metrics: string[];
  metricLabels: Record<string, string>;
  history: Reading[];
};

function shortTs(ts: string) {
  return new Date(ts).toLocaleString([], {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export default function HistoryCharts({ data }: { data: Data }) {
  const timestamps = Array.from(new Set(data.history.map((h) => h.ts))).sort();

  if (timestamps.length < 2) {
    return (
      <div className="panel empty">
        Only {timestamps.length} snapshot so far. Run the collector again (or wait for the
        schedule) to start plotting how the sources diverge over time.
      </div>
    );
  }

  // Pivot: one row per timestamp, one key per source.
  const pivot = (metric: string) => {
    const bySourceTs: Record<string, Record<string, number>> = {};
    for (const h of data.history) {
      if (h.status === "ok" && h[metric] !== null && h[metric] !== undefined) {
        (bySourceTs[h.source] ||= {})[h.ts] = h[metric];
      }
    }
    const activeSources = data.sources.filter((s) => bySourceTs[s]);
    const rows = timestamps.map((ts) => {
      const row: Record<string, any> = { ts: shortTs(ts) };
      for (const s of activeSources) row[s] = bySourceTs[s]?.[ts] ?? null;
      return row;
    });
    return { rows, activeSources };
  };

  const tickStyle = { fill: "#8b98a5", fontSize: 11 };

  return (
    <div className="charts">
      {data.metrics.map((m) => {
        const { rows, activeSources } = pivot(m);
        if (!activeSources.length) return null;
        return (
          <div className="chartbox" key={m}>
            <h3>{data.metricLabels[m]}</h3>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
                <CartesianGrid stroke="#2d3742" />
                <XAxis dataKey="ts" tick={tickStyle} interval="preserveStartEnd" minTickGap={40} />
                <YAxis tick={tickStyle} width={44} domain={["auto", "auto"]} />
                <Tooltip
                  contentStyle={{ background: "#1a2129", border: "1px solid #2d3742", borderRadius: 8, color: "#e6edf3" }}
                  labelStyle={{ color: "#8b98a5" }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {activeSources.map((s) => (
                  <Line
                    key={s}
                    type="monotone"
                    dataKey={s}
                    name={data.sourceLabels[s] || s}
                    stroke={data.sourceColors[s]}
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        );
      })}
    </div>
  );
}
