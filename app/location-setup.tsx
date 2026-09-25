"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "./icons";

const API = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api`;
const SETUP_SKIP_KEY = "weather-setup-skipped";

export type GeoResult = { name: string; lat: number; lon: number };

export type NearbySensor = {
  sensor_index: string;
  name: string | null;
  distance_mi: number | null;
  source_url: string;
};

export function readSetupSkipped(): boolean {
  try {
    return sessionStorage.getItem(SETUP_SKIP_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSetupSkipped() {
  try {
    sessionStorage.setItem(SETUP_SKIP_KEY, "1");
  } catch {
    /* private mode */
  }
}

export function readForceSetup(): boolean {
  try {
    return new URLSearchParams(window.location.search).has("setup");
  } catch {
    return false;
  }
}

export function clearForceSetupQuery() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("setup")) return;
    url.searchParams.delete("setup");
    const qs = url.searchParams.toString();
    window.history.replaceState({}, "", url.pathname + (qs ? `?${qs}` : "") + url.hash);
  } catch {
    /* ignore */
  }
}

// ----------------------------------------------------------- Place search ---

export function PlaceSearch({
  onPicked,
  disabled,
}: {
  onPicked: (r: GeoResult) => void;
  disabled?: boolean;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [geoErr, setGeoErr] = useState<string | null>(null);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    let live = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${API}/geocode?q=${encodeURIComponent(query)}`, { cache: "no-store" });
        const j = await res.json();
        if (!live) return;
        setResults(j.results || []);
        setOpen(true);
      } catch {
        if (live) setResults([]);
      } finally {
        if (live) setSearching(false);
      }
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  const pick = (r: GeoResult) => {
    onPicked(r);
    setQ("");
    setResults([]);
    setOpen(false);
    setGeoErr(null);
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setGeoErr("This browser can’t share a location — search for a place instead.");
      return;
    }
    setLocating(true);
    setGeoErr(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        try {
          const res = await fetch(`${API}/geocode?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`, {
            cache: "no-store",
          });
          const j = await res.json();
          const name = j.result?.name || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
          pick({ name, lat, lon });
        } catch {
          pick({ name: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, lat, lon });
        } finally {
          setLocating(false);
        }
      },
      (err) => {
        setLocating(false);
        setGeoErr(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied — search for a city or address instead."
            : "Couldn’t read your location — search for a city or address instead.",
        );
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60_000 },
    );
  };

  const showResults = open && results.length > 0;

  return (
    <div className="place-search">
      <div className="place-search-row">
        <div className="typeahead">
          <input
            type="text"
            placeholder="Search a city or street address"
            value={q}
            disabled={disabled || locating}
            autoComplete="off"
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && showResults) {
                e.preventDefault();
                pick(results[0]);
              } else if (e.key === "Escape") setOpen(false);
            }}
          />
          {(searching || locating) && <span className="typeahead-spin">…</span>}
          {showResults && (
            <div className="geo-results">
              {results.map((rsl, i) => (
                <button
                  key={i}
                  type="button"
                  className="geo-result"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(rsl);
                  }}
                >
                  <span>{rsl.name}</span>
                  <span className="muted">
                    {rsl.lat.toFixed(3)}, {rsl.lon.toFixed(3)}
                  </span>
                </button>
              ))}
              <div className="geo-attribution">© OpenStreetMap contributors</div>
            </div>
          )}
        </div>
        <button
          type="button"
          className={`icon-btn${locating ? " busy" : ""}`}
          disabled={disabled || locating}
          onClick={useMyLocation}
          aria-label={locating ? "Finding your location" : "Use my location"}
          title="Use my location"
        >
          <Icon name="locate" />
        </button>
      </div>
      {geoErr && <div className="err-msg">{geoErr}</div>}
    </div>
  );
}

// ------------------------------------------------------- Nearby sensors ---

export function useNearbySensors(lat: string, lon: string, enabled: boolean) {
  const [sensors, setSensors] = useState<NearbySensor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled || !lat.trim() || !lon.trim()) {
      setSensors([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ lat: lat.trim(), lon: lon.trim(), limit: "5" });
      const res = await fetch(`${API}/purpleair-sensors?${params.toString()}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `failed (${res.status})`);
      setSensors(j.sensors || (j.sensor ? [j.sensor] : []));
    } catch (e: any) {
      setSensors([]);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [lat, lon, enabled]);

  useEffect(() => {
    if (!enabled || !lat.trim() || !lon.trim()) {
      setSensors([]);
      setError(null);
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    setError(null);
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ lat: lat.trim(), lon: lon.trim(), limit: "5" });
        const res = await fetch(`${API}/purpleair-sensors?${params.toString()}`, { cache: "no-store" });
        const j = await res.json();
        if (!live) return;
        if (!res.ok) throw new Error(j.error || `failed (${res.status})`);
        setSensors(j.sensors || (j.sensor ? [j.sensor] : []));
      } catch (e: any) {
        if (live) {
          setSensors([]);
          setError(e.message);
        }
      } finally {
        if (live) setLoading(false);
      }
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [lat, lon, enabled]);

  return { sensors, loading, error, reload: load };
}

export function NearbySensorPicker({
  sensors,
  loading,
  error,
  selected,
  onSelect,
  onRetry,
}: {
  sensors: NearbySensor[];
  loading: boolean;
  error: string | null;
  selected: string; // sensor index, or "" for skip
  onSelect: (sensorIndex: string) => void;
  onRetry?: () => void;
}) {
  if (loading) return <div className="note" style={{ marginTop: 8 }}>Searching nearby outdoor sensors…</div>;
  if (error) {
    return (
      <div className="pa-err" style={{ marginTop: 8 }}>
        {error}
        {onRetry && (
          <>
            {" · "}
            <button type="button" className="linkbtn" onClick={onRetry}>
              retry
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="sensor-list" role="listbox" aria-label="Nearby PurpleAir sensors">
      {sensors.length === 0 ? (
        <div className="note" style={{ marginTop: 0 }}>
          No outdoor sensor reporting within ~10 miles. You can skip this and add one later.
        </div>
      ) : (
        sensors.map((s) => {
          const picked = selected === s.sensor_index;
          return (
            <button
              key={s.sensor_index}
              type="button"
              role="option"
              aria-selected={picked}
              className={`sensor-opt${picked ? " picked" : ""}`}
              onClick={() => onSelect(s.sensor_index)}
            >
              <span className="sensor-opt-name">{s.name || `Sensor #${s.sensor_index}`}</span>
              <span className="sensor-opt-meta">
                {s.distance_mi != null ? `${s.distance_mi} mi` : ""}
                {s.source_url && (
                  <>
                    {" · "}
                    <a href={s.source_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                      map ↗
                    </a>
                  </>
                )}
              </span>
            </button>
          );
        })
      )}
      <button
        type="button"
        role="option"
        aria-selected={selected === ""}
        className={`sensor-opt skip${selected === "" ? " picked" : ""}`}
        onClick={() => onSelect("")}
      >
        Skip — NWS and Open-Meteo only
      </button>
    </div>
  );
}

export function PurpleAirKeyField({
  onSaved,
  disabled,
}: {
  onSaved: () => void;
  disabled?: boolean;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    const read_key = key.trim();
    if (!read_key) {
      setErr("Paste a READ key first.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`${API}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpleair: { read_key } }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `save failed (${res.status})`);
      }
      setKey("");
      onSaved();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pa-key-inline">
      <label>PurpleAir READ key</label>
      <div className="pa-key-row">
        <input
          type="password"
          autoComplete="off"
          placeholder="paste key"
          value={key}
          disabled={disabled || busy}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
        />
        <button type="button" className="btn secondary" disabled={disabled || busy || !key.trim()} onClick={save}>
          {busy ? "Saving…" : "Save key"}
        </button>
      </div>
      <div className="fg-help" style={{ marginTop: 8 }}>
        Free at{" "}
        <a href="https://develop.purpleair.com" target="_blank" rel="noreferrer">
          develop.purpleair.com
        </a>
        . Optional — NWS and Open-Meteo work without it.
      </div>
      {err && <div className="err-msg" style={{ marginTop: 6 }}>{err}</div>}
    </div>
  );
}

// ----------------------------------------------------------- Setup card ---

export function SetupCard({
  locationId,
  mode = "update",
  hasPurpleairKey,
  onDone,
  onSkip,
}: {
  locationId: string;
  mode?: "update" | "add";
  hasPurpleairKey: boolean;
  onDone: (locId: string) => void | Promise<void>;
  onSkip: () => void;
}) {
  const [name, setName] = useState("");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [showCoords, setShowCoords] = useState(false);
  const [hasKey, setHasKey] = useState(hasPurpleairKey);
  const [pa, setPa] = useState<string | null>(null); // null = auto-pick nearest
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSubmit = lat.trim() !== "" && lon.trim() !== "";
  const { sensors, loading: findingPa, error: paErr, reload: reloadSensors } = useNearbySensors(
    lat,
    lon,
    hasKey && canSubmit,
  );

  useEffect(() => {
    setHasKey(hasPurpleairKey);
  }, [hasPurpleairKey]);

  useEffect(() => {
    if (pa === null && sensors.length > 0) setPa(sensors[0].sensor_index);
  }, [sensors, pa]);

  const pickPlace = (r: GeoResult) => {
    setName(r.name);
    setLat(String(r.lat));
    setLon(String(r.lon));
    setPa(null);
    setErr(null);
  };

  const finish = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      const sensorIndex = (pa === null ? sensors[0]?.sensor_index : pa) || "";
      const fields = { name, lat, lon, purpleair_sensor_index: sensorIndex };
      const locRes = await fetch(`${API}/locations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "add"
            ? { action: "add", ...fields }
            : { action: "update", id: locationId, ...fields },
        ),
      });
      const locJ = await locRes.json();
      if (!locRes.ok) throw new Error(locJ.error || `save failed (${locRes.status})`);
      const id = locJ.location?.id || locationId;
      if (mode === "add") {
        await fetch(`${API}/locations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "select", id }),
        });
      }

      const collectRes = await fetch(`${API}/collect?loc=${encodeURIComponent(id)}`, { method: "POST" });
      if (!collectRes.ok) {
        const j = await collectRes.json().catch(() => ({}));
        throw new Error(j.error || `collect failed (${collectRes.status})`);
      }
      await onDone(id);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const selected = pa === null ? sensors[0]?.sensor_index ?? "" : pa;

  return (
    <div className="panel setup">
      <h2 className="setup-h">Set up your location</h2>
      <p className="setup-lead">
        NWS and Open-Meteo follow the place you pick. A nearby PurpleAir sensor is the local ground truth
        for temperature and air quality — optional, but that’s what this app is for.
      </p>

      <section className="setup-step">
        <div className="setup-step-label">1. Where are you?</div>
        {canSubmit ? (
          <div className="setup-picked">
            <div>
              <div className="setup-picked-name">{name || `${lat}, ${lon}`}</div>
              <div className="muted">
                {Number(lat).toFixed(4)}, {Number(lon).toFixed(4)}
                {" · "}
                <button type="button" className="linkbtn" onClick={() => setShowCoords((s) => !s)}>
                  {showCoords ? "hide coordinates" : "edit coordinates"}
                </button>
              </div>
            </div>
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                setName("");
                setLat("");
                setLon("");
                setPa(null);
                setShowCoords(false);
              }}
            >
              Change
            </button>
          </div>
        ) : (
          <PlaceSearch onPicked={pickPlace} disabled={busy} />
        )}
        {showCoords && (
          <div className="loc-grid" style={{ marginTop: 10 }}>
            <div>
              <label>Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label>Latitude</label>
              <input type="text" inputMode="decimal" value={lat} onChange={(e) => { setLat(e.target.value); setPa(null); }} />
            </div>
            <div>
              <label>Longitude</label>
              <input type="text" inputMode="decimal" value={lon} onChange={(e) => { setLon(e.target.value); setPa(null); }} />
            </div>
          </div>
        )}
      </section>

      <section className="setup-step">
        <div className="setup-step-label">2. Nearby PurpleAir sensor</div>
        {!canSubmit ? (
          <div className="note" style={{ marginTop: 0 }}>Pick a place first — we’ll look for outdoor sensors around it.</div>
        ) : !hasKey ? (
          <PurpleAirKeyField
            disabled={busy}
            onSaved={() => {
              setHasKey(true);
              setPa(null);
            }}
          />
        ) : (
          <NearbySensorPicker
            sensors={sensors}
            loading={findingPa}
            error={paErr}
            selected={selected}
            onSelect={setPa}
            onRetry={reloadSensors}
          />
        )}
      </section>

      <div className="setup-actions">
        <button className="btn" disabled={busy || !canSubmit || (hasKey && findingPa)} onClick={finish}>
          {busy ? "Saving…" : "Save and collect"}
        </button>
        <button
          type="button"
          className="btn secondary"
          disabled={busy}
          onClick={() => {
            writeSetupSkipped();
            onSkip();
          }}
        >
          Not now
        </button>
        {err && <span className="err-msg">{err}</span>}
      </div>
    </div>
  );
}
