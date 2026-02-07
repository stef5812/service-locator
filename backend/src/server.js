import "dotenv/config";
import express from "express";
import cors from "cors";

import { prisma } from "./prisma.js";
import importRouter from "./routes/import.js";
import geocodeRouter from "./routes/geocode.js";
import locationsRouter from "./routes/locations.js";


const app = express();

app.use(cors());
app.use(express.json());

// health check
app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// routes
app.use("/api/import", importRouter(prisma));
app.use("/api/geocode", geocodeRouter(prisma));
app.use("/api/locations", locationsRouter(prisma));

const PORT = process.env.PORT || 3007;
app.listen(PORT, () =>
  console.log(`API running on http://127.0.0.1:${PORT}`)
);
