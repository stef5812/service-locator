import { Router } from "express";

export default function locationsRouter(prisma) {
  const r = Router();

  // get all active locations
  r.get("/", async (req, res) => {
    const rows = await prisma.location.findMany({
      where: { isActive: true },
      orderBy: { updatedAt: "desc" },
    });
    res.json(rows);
  });

  // create
  r.post("/", async (req, res) => {
    const row = await prisma.location.create({ data: req.body });
    res.json(row);
  });

  // update
  r.put("/:id", async (req, res) => {
    const row = await prisma.location.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(row);
  });

  return r;
}
