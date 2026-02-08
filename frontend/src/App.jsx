// App.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import logo from "./assets/logo.png";

import {
  APIProvider,
  Map,
  Marker,
  InfoWindow,
  useMap,
} from "@vis.gl/react-google-maps";

const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:3007";

// IMPORTANT: your SVGs should be here:
// frontend/public/assets/map-icons/*.svg
const ICON_BASE = `${import.meta.env.BASE_URL}assets/map-icons`;

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

function markerIconForType(type) {
  const url = ICON_BY_TYPE[type];
  if (!url) return undefined;
  if (!window.google?.maps?.Size || !window.google?.maps?.Point) return undefined;

  // Adjust as you like
  const w = 28;
  const h = 28;

  return {
    url,
    scaledSize: new window.google.maps.Size(w, h),
    anchor: new window.google.maps.Point(w / 2, h),
  };
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

    if (typeof targetZoom === "number") {
      map.setZoom(targetZoom);
    }

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
  const [locations, setLocations] = useState([]);
  const [visibleTypes, setVisibleTypes] = useState({});
  const [flashType, setFlashType] = useState(null);

  const [selected, setSelected] = useState(null);

  // For explicit pan/zoom actions
  const [targetCenter, setTargetCenter] = useState(null);
  const [targetZoom, setTargetZoom] = useState(null);

  const [userPos, setUserPos] = useState(null);
  const [query, setQuery] = useState("");

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

  function toggleType(t) {
    setVisibleTypes((prev) => ({ ...prev, [t]: !prev[t] }));
    setSelected((prev) => (prev?.type === t ? null : prev)); // close popup if hiding type
    setFlashType(t);
    window.setTimeout(() => setFlashType(null), 1200);
  }

  function useMyLocation() {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserPos(p);
        setTargetCenter(p);
        setTargetZoom(14); // ✅ zoom in a bit
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
    setTargetZoom(14); // ✅ zoom in a bit when going to an Eircode
  }

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      {/* MAP full-screen behind */}
      <APIProvider apiKey={import.meta.env.VITE_GOOGLE_MAPS_KEY}>
        <Map
          defaultCenter={{ lat: 53.3498, lng: -6.2603 }}
          defaultZoom={7}
          style={{ width: "100%", height: "100%" }}
          gestureHandling="greedy"
        >
          <PanToCenter targetCenter={targetCenter} targetZoom={targetZoom} />
          <FitBoundsOnce
            points={fitPoints}
            disable={typeof targetZoom === "number"}
          />

          {filtered.map((l) => (
            <Marker
              key={l.id}
              position={{ lat: l.lat, lng: l.lng }}
              title={l.name || ""}
              className={flashType === l.type ? "pulse" : ""}
              icon={markerIconForType(l.type)}
              onClick={() => setSelected(l)}
            />
          ))}

          {selected ? (
            <InfoWindow
              position={{ lat: selected.lat, lng: selected.lng }}
              onCloseClick={() => setSelected(null)}
            >
              <div style={{ maxWidth: 280 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 8,
                  }}
                >
                  {ICON_BY_TYPE[selected.type] ? (
                    <img
                      src={ICON_BY_TYPE[selected.type]}
                      alt=""
                      aria-hidden="true"
                      style={{ width: 44, height: 44, flex: "0 0 auto" }}
                    />
                  ) : null}

                  <div style={{ fontWeight: 700 }}>
                    {selected.name || "Untitled"}
                  </div>
                </div>

                <div style={{ fontSize: 12, color: "#444", marginBottom: 6 }}>
                  <div>
                    <b>Type:</b> {selected.type}
                  </div>
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
                  <div style={{ fontSize: 12 }}>
                    <a href={selected.website} target="_blank" rel="noreferrer">
                      Website
                    </a>
                  </div>
                ) : null}
              </div>
            </InfoWindow>
          ) : null}
        </Map>
      </APIProvider>

      {/* FLOATING SIDEBAR overlays the map */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          width: 360,
          maxHeight: "calc(100% - 24px)",
          overflow: "auto",
          padding: 12,
          borderRadius: 14,
          background: "rgba(255,255,255,0.82)",
          backdropFilter: "blur(8px)",
          boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
          border: "1px solid rgba(255,255,255,0.35)",
        }}
      >          
        <img
          src={logo}
          alt="Your app logo"
          className="mapLogo"
        />
        <h2 style={{ marginTop: 0 }}>Locations</h2>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button onClick={useMyLocation}>Use my location</button>
          {userPos ? (
            <span style={{ fontSize: 12, color: "#666", alignSelf: "center" }}>
              {userPos.lat.toFixed(5)}, {userPos.lng.toFixed(5)}
            </span>
          ) : null}
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter Eircode..."
            style={{ flex: 1 }}
          />
          <button onClick={geocode}>Go</button>
        </div>

        <h3>Key (Type)</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {types.map((t) => (
            <button
              key={t}
              onClick={() => toggleType(t)}
              style={{
                opacity: visibleTypes[t] === false ? 0.45 : 1,
                border: flashType === t ? "2px solid black" : "1px solid #ccc",
                padding: "6px 10px",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "#fff",
              }}
            >
              {ICON_BY_TYPE[t] ? (
                <img
                  src={ICON_BY_TYPE[t]}
                  alt=""
                  aria-hidden="true"
                  style={{ width: 18, height: 18, display: "block" }}
                />
              ) : null}
              <span>{t}</span>
            </button>
          ))}
        </div>

        <div style={{ marginTop: 16, fontSize: 12, color: "#555" }}>
          Showing {filtered.length} / {locations.length}
        </div>

        <div style={{ marginTop: 12, fontSize: 12, color: "#777" }}>
          API: {API_BASE}
        </div>
      </div>

      <style>{`
        .mapLogo {
          height: 48px;   /* try 40–60px */
          width: auto;    /* keeps proportions */
          display: block;
        }
        .pulse {
          animation: pulse 0.6s ease-in-out 0s 2;
        }
        @keyframes pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.35); }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
