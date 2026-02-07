// backend/routes/import.js
// ESM router for: POST /api/import/excel
// - Handles CSV/TSV/semicolon
// - Strips UTF-8 BOM from first header
// - Normalises headers
// - Strips outer quotes safely
// - Robust toNumber for lat/lng
// - Per-row skip/error reasons (first 5)
// - Uses parsed lat/lng in Prisma write (the common “final bug”)
// - Upserts by (source, sourceId) only when sourceId exists; otherwise creates

// src/routes/import.js
// Usage: app.use("/api/import", importRouter(prisma))
// Endpoint: POST /api/import/excel  (multipart/form-data, field name: file)

import express from "express";
import multer from "multer";

export default function importRouter(prisma) {
  const router = express.Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  });

  // ---------- helpers ----------
  function stripBom(s = "") {
    return String(s).replace(/^\uFEFF/, "");
  }

  function normalizeHeader(h = "") {
    return stripBom(String(h))
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[_-]+/g, "");
  }

  function stripOuterQuotes(v) {
    if (v === null || v === undefined) return "";
    let s = stripBom(String(v)).trim();

    if (
      (s.startsWith('"') && s.endsWith('"')) ||
      (s.startsWith("'") && s.endsWith("'"))
    ) {
      s = s.slice(1, -1).trim();
    }

    // Excel escaping: "" -> "
    s = s.replace(/""/g, '"');
    return s;
  }

  function toNumber(v) {
    if (v === null || v === undefined) return null;

    let s = stripOuterQuotes(v);
    if (!s) return null;

    // keep digits and common numeric chars only
    s = s.replace(/[^\d.,+-]/g, "");
    if (!s) return null;

    if (s.includes(",") && s.includes(".")) {
      // 1,234.56 -> 1234.56
      s = s.replace(/,/g, "");
    } else if (s.includes(",") && !s.includes(".")) {
      // 51,901 -> 51.901
      s = s.replace(/,/g, ".");
    }

    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function detectDelimiter(sampleLine = "") {
    const candidates = ["\t", ";", ","];
    let best = candidates[0];
    let bestCount = -1;

    for (const d of candidates) {
      const count = sampleLine.split(d).length;
      if (count > bestCount) {
        best = d;
        bestCount = count;
      }
    }
    return best;
  }

  function splitDelimitedLine(line, delim) {
    const out = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (!inQuotes && ch === delim) {
        out.push(cur);
        cur = "";
        continue;
      }

      cur += ch;
    }

    out.push(cur);
    return out;
  }

  function parseDelimited(text) {
    const lines = text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .filter((l) => l.trim().length > 0);

    if (lines.length === 0) return { rows: [], delimiter: "," };

    const delimiter = detectDelimiter(lines[0]);
    const rawHeaders = splitDelimitedLine(lines[0], delimiter);
    const headers = rawHeaders.map((h) => normalizeHeader(h));

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = splitDelimitedLine(lines[i], delimiter);
      const row = {};
      for (let c = 0; c < headers.length; c++) {
        const key = headers[c] || `col${c}`;
        row[key] = cols[c] ?? "";
      }
      rows.push(row);
    }

    return { rows, delimiter };
  }

  function pick(row, ...keys) {
    for (const k of keys) {
      if (row[k] !== undefined) return row[k];
    }
    return undefined;
  }

  // ---------- route ----------
  router.post("/excel", upload.single("file"), async (req, res) => {
    const version = "bomfix-2026-02-07-v4-prisma-injected";

    try {
      if (!req.file?.buffer) {
        return res.status(400).json({ ok: false, error: "No file uploaded" });
      }

      const text = req.file.buffer.toString("utf8");
      const { rows, delimiter } = parseDelimited(text);

      let inserted = 0;
      let updated = 0;
      let skipped = 0;

      const reasons = [];
      function skip(reason, row, idx) {
        skipped++;
        if (reasons.length < 5) {
          reasons.push({
            idx,
            reason,
            name: stripOuterQuotes(pick(row, "name")),
            type: stripOuterQuotes(pick(row, "type")),
            lat: pick(row, "lat"),
            lng: pick(row, "lng"),
            sourceid: pick(row, "sourceid", "sourceId"),
          });
        }
      }

      const firstRow = rows[0] || {};
      const latFirst = toNumber(pick(firstRow, "lat"));
      const lngFirst = toNumber(pick(firstRow, "lng"));

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];

        const name = stripOuterQuotes(pick(r, "name"));
        const type = stripOuterQuotes(pick(r, "type"));
        const eircode = stripOuterQuotes(pick(r, "eircode")) || null;
        const address = stripOuterQuotes(pick(r, "address")) || null;

        const email = stripOuterQuotes(pick(r, "email")) || null;
        const phone = stripOuterQuotes(pick(r, "phone")) || null;
        const contact1 = stripOuterQuotes(pick(r, "contact1")) || null;
        const contact2 = stripOuterQuotes(pick(r, "contact2")) || null;
        const contact3 = stripOuterQuotes(pick(r, "contact3")) || null;
        const link =
          stripOuterQuotes(pick(r, "link", "website", "url")) || null;

        const source = stripOuterQuotes(pick(r, "source")) || "import";
        const sourceIdRaw = stripOuterQuotes(pick(r, "sourceid", "sourceId"));
        const sourceId = sourceIdRaw ? sourceIdRaw : null;

        const lat = toNumber(pick(r, "lat", "latitude"));
        const lng = toNumber(pick(r, "lng", "lon", "long", "longitude"));

        if (!name) {
          skip("missing name", r, i);
          continue;
        }
        if (!type) {
          skip("missing type", r, i);
          continue;
        }
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          skip("invalid coords after parse", r, i);
          continue;
        }

        const data = {
          name,
          type,
          eircode,
          address,
          lat,
          lng,
          email,
          phone,
          contact1,
          contact2,
          contact3,
          link,
          isActive: true,
          source,
          sourceId,
        };

        try {
          if (sourceId) {
            const existing = await prisma.location.findUnique({
              where: { source_sourceId: { source, sourceId } },
              select: { id: true },
            });

            await prisma.location.upsert({
              where: { source_sourceId: { source, sourceId } },
              update: data,
              create: data,
            });

            if (existing) updated++;
            else inserted++;
          } else {
            await prisma.location.create({ data });
            inserted++;
          }
        } catch (e) {
          skip(`prisma error: ${e?.code || e?.message || "unknown"}`, r, i);
        }
      }

      return res.json({
        ok: true,
        version,
        file: req.file.originalname,
        delimiter,
        rows: rows.length,
        inserted,
        updated,
        skipped,
        firstRowKeys: Object.keys(firstRow),
        firstRowSample: firstRow,
        debugFirst: {
          latRaw: pick(firstRow, "lat"),
          lngRaw: pick(firstRow, "lng"),
          latParsed: latFirst,
          lngParsed: lngFirst,
          hasCoords: Number.isFinite(latFirst) && Number.isFinite(lngFirst),
        },
        reasons,
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        version,
        error: err?.message || "Import failed",
      });
    }
  });

  return router;
}
