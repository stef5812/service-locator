import "dotenv/config";
import { prisma } from "./src/prisma.js";

async function main() {
  const db = await prisma.$queryRawUnsafe(
    "select current_database() as db, current_schema() as schema;"
  );
  console.log("DB:", db);

  const tables = await prisma.$queryRawUnsafe(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;"
  );
  console.log("Tables:", tables);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
