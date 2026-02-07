import { Router } from "express";


function normalizeQuery(q = "") {
  return q.trim().toUpperCase().replace(/\s+/g, "");
}

async function googleGeocode(query) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("Missing GOOGLE_MAPS_API_KEY");

  const url =
    "https://maps.googleapis.com/maps/api/geocode/json?address=" +
    encodeURIComponent(query) +
    "&key=" +
    encodeURIComponent(key);

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Geocode HTTP ${resp.status}`);

  const data = await resp.json();

  // If Google didn't return OK, surface diagnostics
  if (data.status !== "OK" || !data.results?.length) {
    return {
      error: true,
      status: data.status,
      message: data.error_message || null,
      query,
    };
  }

  const loc = data.results[0].geometry.location;
  return { lat: loc.lat, lng: loc.lng, provider: "google" };
}

export default function geocodeRouter(prisma) {
  const r = Router();

  // POST /api/geocode { query: "D02 X285" }
  r.post("/", async (req, res) => {
    try {
      const query = String(req.body?.query || "").trim();
      if (!query) return res.status(400).json({ error: "Missing query" });

      const normalized = normalizeQuery(query);

      // cache first
      const cached = await prisma.geocodeCache.findUnique({
        where: { normalizedQuery: normalized },
      });

      if (cached) {
        await prisma.geocodeCache.update({
          where: { id: cached.id },
          data: {
            hitCount: { increment: 1 },
            lastUsedAt: new Date(),
          },
        });
        return res.json({ lat: cached.lat, lng: cached.lng, cached: true });
      }

      // Try a few variants (helps Eircodes + Irish queries)
      const attempts = [
        query,
        `${query} Ireland`,
        `${query} Dublin Ireland`,
      ];

      let result = null;

      for (const q of attempts) {
        const r1 = await googleGeocode(q);

        // If it's an "error object", keep it for diagnostics and try next
        if (r1?.error) {
          result = r1;
          continue;
        }

        // Found a valid lat/lng
        result = r1;
        break;
      }

      // If final result is still an error, return the diagnostic
      if (result?.error) {
        return res.status(502).json({
          error: "Geocode failed",
          status: result.status,
          message: result.message,
          attempted: attempts,
        });
      }

      if (!result) {
        return res.status(404).json({ error: "Not found" });
      }

      // Save to cache
      await prisma.geocodeCache.create({
        data: {
          normalizedQuery: normalized,
          displayQuery: query,
          lat: result.lat,
          lng: result.lng,
          provider: result.provider,
          hitCount: 1,
          lastUsedAt: new Date(),
        },
      });

      return res.json({ lat: result.lat, lng: result.lng, cached: false });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  return r;
}
