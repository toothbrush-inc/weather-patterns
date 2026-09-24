"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const Clock = createContext<number | null>(null);

export function WeatherClock({ nowMs, children }: { nowMs?: number; children: ReactNode }) {
  const [liveNow, setLiveNow] = useState(() => Date.now());
  useEffect(() => {
    if (nowMs != null) return;
    const timer = setInterval(() => setLiveNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [nowMs]);
  return <Clock.Provider value={nowMs ?? liveNow}>{children}</Clock.Provider>;
}

export function useWeatherNow() { return useContext(Clock) ?? Date.now(); }
