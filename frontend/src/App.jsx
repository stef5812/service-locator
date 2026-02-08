// App.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import logo from "./assets/logo.png";

import {
  APIProvider,
  Map as GoogleMap,
  Marker,
  InfoWindow,
  useMap,
} from "@vis.gl/react-google-maps";

const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:3007";

// IMPORTANT: your SVGs should be here:
// frontend/public/assets/map-icons/*.svg
const ICON_BASE = `${import.meta.env.BASE_URL}assets/map-icons`;

const LABEL_BY_TYPE = {
  CHIME: "Deaf & Hard of Hearing Services",
  ALZ: "Alzheimer’s & Dementia Support",
  WA: "West Cork Services",
  NCBI: "Vision Impairment Support",
  PHA: "Public Health",
  NURSE: "Community Nursing",
  MOW: "Meals on Wheels",
  MABS: "Money Advice & Budgeting",
  PCARE: "Primary Care",
  HOSP: "Hospital Services",
  HSE: "Health Service Executive",
  "24hr-Garda": "Gardaí (24-hour)",
  Garda: "Garda Station",
  coco: "County Council",
  cyco: "City Council",
  regco: "Regional Council",
};

const ICON_BY_TYPE = {
  CHIME: `${ICON_BASE}/CHIME.svg`,
  ALZ: `${ICON_BASE}/ALZ.svg`,
  WA: `${ICON_BASE}/WA.svg`,
  NCBI: `${ICON_BASE}/NCBI.svg`,
  PHA: `${ICON_BASE}/PHA.svg`,
  NURSE: `${ICON_BASE}/NURSE.svg`,
  MOW: `${ICON_BASE}/MOW.svg`,
  MABS: `${ICON_BASE}/MABS.svg`,
  PCARE: `${ICON_BASE}/PCARE.svg`,
  HOSP: `${ICON_BASE}/HOSP.svg`,
  HSE: `${ICON_BASE}/HSE.svg`,
  "24hr-Garda": `${ICON_BASE}/24hr-Garda.svg`,
  Garda: `${ICON_BASE}/Garda.svg`,
  coco: `${ICON_BASE}/coco.svg`,
  cyco: `${ICON_BASE}/cyco.svg`,
  regco: `${ICON_BASE}/regco.svg`,
};

// ---- Marker sizing + blink (polished but safe) ----
const SIZE_BASE = 44;
const SIZE_SELECTED = 62;
const BLINK_SIZES = [44, 70, 40, 66, 44];
const BLINK_STEP_MS = 120;

// Cache icons: key = `${type}|${size}`
const iconCache = new globalThis.Map();

function buildMarkerIcon(type, size) {
  const url = ICON_BY_TYPE[type];
  if (!url) return undefined;

  // google maps objects only exist after the API loads
  if (!window.google?.maps?.Size || !window.google?.maps?.Point) return undefined;

  const key = `${type}|${size}`;
  if (iconCache.has(key)) return iconCache.get(key);

  const icon = {
    url,
    scaledSize: new window.google.maps.Size(size, size),
    // bottom-center anchor so it "sits" on the location
    anchor: new window.google.maps.Point(size / 2, size),
  };

  iconCache.set(key, icon);
  return icon;
}

/**
 * Pan + optional zoom when target changes.
 * (Doesn't "control" the map; user can still pan/zoom freely afterwards.)
 */
function PanToCenter({ targetCenter, targetZoom }) {
  const map = useMap();
  const lastKeyRef = useRef("");

  useEffect(() => {
    if (!map || !targetCenter) return;

    const key = `${targetCenter.lat.toFixed(6)},${targetCenter.lng.toFixed(
      6
    )},${targetZoom ?? ""}`;

    if (lastKeyRef.current === key) return;

    map.panTo(targetCenter);
    if (typeof targetZoom === "number") map.setZoom(targetZoom);

    lastKeyRef.current = key;
  }, [map, targetCenter, targetZoom]);

  return null;
}

/**
 * Fit bounds ONCE after markers load (won't keep snapping the map).
 * Can be disabled (e.g. while doing an explicit geocode zoom).
 */
function FitBoundsOnce({ points, disable }) {
  const map = useMap();
  const didFitRef = useRef(false);

  useEffect(() => {
    if (disable) return;
    if (!map) return;
    if (!points || points.length === 0) return;
    if (!window.google?.maps?.LatLngBounds) return;
    if (didFitRef.current) return;

    const bounds = new window.google.maps.LatLngBounds();
    for (const p of points) bounds.extend(p);
    map.fitBounds(bounds, 60);

    didFitRef.current = true;
  }, [map, points, disable]);

  return null;
}

export default function App() {
  // ✅ Retractable sidebar (persisted)
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const saved = localStorage.getItem("serviceLocator.sidebarOpen");
    return saved === null ? true : saved === "true";
  });

  useEffect(() => {
    localStorage.setItem("serviceLocator.sidebarOpen", String(sidebarOpen));
  }, [sidebarOpen]);

  // Optional: press "s" to toggle sidebar (doesn't trigger while typing)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key.toLowerCase() !== "s") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      setSidebarOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const [locations, setLocations] = useState([]);
  const [visibleTypes, setVisibleTypes] = useState({});
  const [selected, setSelected] = useState(null);

  // For explicit pan/zoom actions
  const [targetCenter, setTargetCenter] = useState(null);
  const [targetZoom, setTargetZoom] = useState(null);

  const [userPos, setUserPos] = useState(null);
  const [query, setQuery] = useState("");

  // Blink state: type -> step index (0 = no blink)
  const [blinkStepByType, setBlinkStepByType] = useState({});
  const blinkTimeoutsRef = useRef({}); // plain object (safe)

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      for (const k of Object.keys(blinkTimeoutsRef.current)) {
        clearTimeout(blinkTimeoutsRef.current[k]);
      }
    };
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/api/locations`)
      .then((r) => r.json())
      .then((data) => {
        const arr = Array.isArray(data) ? data : [];
        setLocations(arr);

        // start with no markers visible
        const types = [...new Set(arr.map((d) => d.type).filter(Boolean))];
        const init = {};
        for (const t of types) init[t] = false;
        setVisibleTypes(init);
      })
      .catch(() => {
        setLocations([]);
        setVisibleTypes({});
      });
  }, []);

  const types = useMemo(
    () => [...new Set(locations.map((l) => l.type).filter(Boolean))],
    [locations]
  );

  const filtered = useMemo(() => {
    return locations.filter((l) => {
      if (!l.type) return false;
      if (visibleTypes[l.type] === false) return false;
      if (typeof l.lat !== "number" || typeof l.lng !== "number") return false;
      return true;
    });
  }, [locations, visibleTypes]);

  const fitPoints = useMemo(
    () => filtered.map((l) => ({ lat: l.lat, lng: l.lng })),
    [filtered]
  );

  function startBlinkForType(t) {
    // clear any prior sequence
    if (blinkTimeoutsRef.current[t]) clearTimeout(blinkTimeoutsRef.current[t]);

    const run = (step) => {
      setBlinkStepByType((prev) => ({ ...prev, [t]: step }));

      if (step >= BLINK_SIZES.length - 1) {
        // finish: reset after one last tick
        blinkTimeoutsRef.current[t] = setTimeout(() => {
          setBlinkStepByType((prev) => ({ ...prev, [t]: 0 }));
          blinkTimeoutsRef.current[t] = null;
        }, BLINK_STEP_MS);
        return;
      }

      blinkTimeoutsRef.current[t] = setTimeout(
        () => run(step + 1),
        BLINK_STEP_MS
      );
    };

    // Start at 1 so it visibly "pops"
    run(1);
  }

  function toggleType(t) {
    setVisibleTypes((prev) => {
      const next = !prev[t];
      if (next) startBlinkForType(t); // blink only when turning ON
      return { ...prev, [t]: next };
    });

    // close popup if hiding selected type
    setSelected((prev) => (prev?.type === t ? null : prev));
  }

  function useMyLocation() {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserPos(p);
        setTargetCenter(p);
        setTargetZoom(14);
      },
      (err) => alert(err.message),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function geocode() {
    const q = query.trim();
    if (!q) return;

    const resp = await fetch(`${API_BASE}/api/geocode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: q }),
    });

    const data = await resp.json();
    if (!resp.ok) return alert(data.error || "Geocode failed");

    setTargetCenter({ lat: data.lat, lng: data.lng });
    setTargetZoom(14);
  }

  function sizeForLocation(l) {
    const t = l.type;
    const blinkStep = blinkStepByType[t] || 0;

    if (blinkStep > 0) {
      return BLINK_SIZES[Math.min(blinkStep, BLINK_SIZES.length - 1)];
    }
    if (selected?.id === l.id) return SIZE_SELECTED;
    return SIZE_BASE;
  }

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      {/* MAP full-screen behind */}
      <APIProvider apiKey={import.meta.env.VITE_GOOGLE_MAPS_KEY}>
        <GoogleMap
          defaultCenter={{ lat: 53.3498, lng: -6.2603 }}
          defaultZoom={7}
          style={{ width: "100%", height: "100%" }}
          gestureHandling="greedy"
          // optional “cleaner” UI feel:
          // disableDefaultUI={true}
          // zoomControl={true}
        >
          <PanToCenter targetCenter={targetCenter} targetZoom={targetZoom} />
          <FitBoundsOnce
            points={fitPoints}
            disable={typeof targetZoom === "number"}
          />

          {filtered.map((l) => {
            const size = sizeForLocation(l);
            return (
              <Marker
                key={l.id}
                position={{ lat: l.lat, lng: l.lng }}
                // More polished tooltip text:
                title={`${l.name || "Service"} — ${LABEL_BY_TYPE[l.type] ?? l.type}`}
                icon={buildMarkerIcon(l.type, size)}
                onClick={() => setSelected(l)}
              />
            );
          })}

          {selected ? (
            <InfoWindow
              position={{ lat: selected.lat, lng: selected.lng }}
              onCloseClick={() => setSelected(null)}
            >
              <div style={{ maxWidth: 300, fontFamily: "inherit" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 10,
                  }}
                >
                  {ICON_BY_TYPE[selected.type] ? (
                    <img
                      src={ICON_BY_TYPE[selected.type]}
                      alt=""
                      aria-hidden="true"
                      style={{
                        width: 44,
                        height: 44,
                        flex: "0 0 auto",
                      }}
                    />
                  ) : null}

                  <div>
                    <div style={{ fontWeight: 800, fontSize: 14, lineHeight: 1.1 }}>
                      {selected.name || "Untitled"}
                    </div>
                    <div style={{ fontSize: 12, color: "rgba(15,23,42,0.65)" }}>
                      {LABEL_BY_TYPE[selected.type] ?? selected.type}
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: 12, color: "#334155", lineHeight: 1.5 }}>
                  {selected.address ? (
                    <div>
                      <b>Address:</b> {selected.address}
                    </div>
                  ) : null}
                  {selected.phone ? (
                    <div>
                      <b>Phone:</b> {selected.phone}
                    </div>
                  ) : null}
                  {selected.email ? (
                    <div>
                      <b>Email:</b> {selected.email}
                    </div>
                  ) : null}
                </div>

                {selected.website ? (
                  <div style={{ marginTop: 10 }}>
                    <a
                      href={selected.website}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 12,
                        fontWeight: 700,
                        textDecoration: "none",
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: "1px solid rgba(17,24,39,0.12)",
                        background: "white",
                        color: "#0f172a",
                      }}
                    >
                      Visit website →
                    </a>
                  </div>
                ) : null}
              </div>
            </InfoWindow>
          ) : null}
        </GoogleMap>
      </APIProvider>

      {/* FLOATING SIDEBAR overlays the map */}
      <div className={`sidebar ${sidebarOpen ? "open" : "closed"}`}>
        <button
          className="sidebarToggle"
          onClick={() => setSidebarOpen((v) => !v)}
          aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          title={sidebarOpen ? "Hide" : "Show"}
        >
          {sidebarOpen ? "◀" : "▶"}
        </button>

        <div className="sidebarInner">
          <img src={logo} alt="Your app logo" className="mapLogo" />

          <div className="subtitle">Service Locator</div>

          <h2>Services</h2>

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button className="btn primary" onClick={useMyLocation}>
              Use current location
            </button>

            {userPos ? (
              <span
                style={{
                  fontSize: 12,
                  color: "rgba(15,23,42,0.65)",
                  alignSelf: "center",
                  whiteSpace: "nowrap",
                }}
              >
                {userPos.lat.toFixed(5)}, {userPos.lng.toFixed(5)}
              </span>
            ) : null}
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter Eircode or area…"
              style={{ flex: 1 }}
            />
            <button className="btn" onClick={geocode}>
              Search
            </button>
          </div>

          <div className="divider" />

          <h3>Filter by service</h3>

          <div className="chips">
            {types.map((t) => (
              <div
                key={t}
                className={`chip ${visibleTypes[t] === false ? "off" : ""}`}
                onClick={() => toggleType(t)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") toggleType(t);
                }}
                title="Toggle markers"
              >
                {ICON_BY_TYPE[t] ? (
                  <img src={ICON_BY_TYPE[t]} alt="" aria-hidden="true" />
                ) : null}
                <span>{LABEL_BY_TYPE[t] ?? t}</span>
              </div>
            ))}
          </div>

          <div className="meta">
            <span>
              Showing <b>{filtered.length}</b> / {locations.length}
            </span>
            <span style={{ textAlign: "right" }}>
              API:{" "}
              <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
                {API_BASE}
              </span>
            </span>
          </div>
        </div>
      </div>

      <style>{`
        :root{
          --bg: rgba(255,255,255,0.86);
          --bg-strong: rgba(255,255,255,0.94);
          --border: rgba(17,24,39,0.12);
          --text: #0f172a;
          --muted: rgba(15,23,42,0.65);
          --shadow: 0 16px 40px rgba(2,6,23,0.18);
          --shadow-soft: 0 10px 30px rgba(2,6,23,0.12);
          --radius: 16px;
          --radius-sm: 12px;
          --focus: 0 0 0 4px rgba(59,130,246,0.18);
        }

        body{
          margin: 0;
          font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
          color: var(--text);
        }

        /* sidebar base */
        .sidebar{
          position: absolute;
          top: 55px;        /* moved down */
          left: 12px;
          width: 270px;     /* thinner */
          max-height: calc(100% - 24px);
          overflow: visible;
          padding: 14px;
          border-radius: var(--radius);
          background: var(--bg);
          backdrop-filter: blur(10px);
          border: 1px solid var(--border);
          box-shadow: var(--shadow);
          transition: transform 220ms ease, box-shadow 220ms ease;
          will-change: transform;
        }

        .sidebarInner{
          transition: opacity 180ms ease;
          overflow: auto;
        }

        /* retract behavior */
        .sidebar.closed{
          transform: translateX(calc(-100% + 44px)); /* leaves a small tab visible */
          box-shadow: none;
        }

        .sidebar.closed .sidebarInner{
          opacity: 0;
          pointer-events: none;
        }

        /* the little tab button */
        .sidebarToggle{
          position: absolute;
          top: 14px;
          right: -14px;
          width: 32px;
          height: 32px;
          border-radius: 999px;
          border: 1px solid rgba(17,24,39,0.12);
          background: rgba(255,255,255,0.92);
          backdrop-filter: blur(10px);
          cursor: pointer;
          font-weight: 900;
          box-shadow: 0 10px 22px rgba(2,6,23,0.16);
          display: grid;
          place-items: center;
          transition: transform 0.08s ease, box-shadow 0.15s ease;
        }

        .sidebarToggle:hover{
          transform: translateY(-1px);
          box-shadow: 0 12px 26px rgba(2,6,23,0.18);
        }

        .sidebar h2{
          margin: 10px 0 8px;
          font-size: 18px;
          letter-spacing: -0.02em;
        }

        .sidebar h3{
          margin: 14px 0 8px;
          font-size: 13px;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .subtitle{
          margin: 0 0 6px;
          font-size: 12px;
          color: var(--muted);
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        .mapLogo{
          height: 42px;
          width: auto;
          display: block;
          margin-bottom: 6px;
          filter: drop-shadow(0 8px 18px rgba(2,6,23,0.10));
        }

        .input{
          height: 40px;
          padding: 0 12px;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: var(--bg-strong);
          outline: none;
          font-size: 14px;
          color: var(--text);
        }
        .input:focus{
          box-shadow: var(--focus);
          border-color: rgba(59,130,246,0.45);
        }

        .btn{
          height: 40px;
          padding: 0 12px;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: white;
          cursor: pointer;
          font-weight: 700;
          font-size: 14px;
          transition: transform 0.05s ease, box-shadow 0.15s ease, background 0.15s ease;
          color: var(--text);
        }
        .btn:hover{
          box-shadow: var(--shadow-soft);
          transform: translateY(-1px);
        }
        .btn:active{
          transform: translateY(0px);
          box-shadow: none;
        }
        .btn.primary{
          background: #2563eb;
          border-color: rgba(37,99,235,0.55);
          color: white;
        }
        .btn.primary:hover{
          background: #1d4ed8;
        }

        .divider{
          height: 1px;
          background: rgba(2,6,23,0.08);
          margin: 12px 0;
        }

        .chips{
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .chip{
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          border-radius: 999px;
          border: 1px solid var(--border);
          background: white;
          cursor: pointer;
          user-select: none;
          font-size: 13px;
          font-weight: 700;
          transition: transform 0.05s ease, box-shadow 0.15s ease, opacity 0.15s ease, background 0.15s ease;
        }
        .chip:hover{
          transform: translateY(-1px);
          box-shadow: var(--shadow-soft);
        }
        .chip:focus{
          outline: none;
          box-shadow: var(--focus);
        }
        .chip.off{
          opacity: 0.48;
          background: rgba(255,255,255,0.7);
        }
        .chip img{
          width: 18px;
          height: 18px;
          display: block;
        }

        .meta{
          margin-top: 14px;
          font-size: 12px;
          color: var(--muted);
          display: flex;
          justify-content: space-between;
          gap: 10px;
        }
      `}</style>
    </div>
  );
}
