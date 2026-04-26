import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Intentionally no-op:
  // Demo/sample seed data was removed; only real exchange/database data is used.
  console.info("Seed skipped: demo/sample data generation disabled.");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error("Seed error:", error);
    await prisma.$disconnect();
    process.exit(1);
  });
