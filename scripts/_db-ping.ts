import { prisma } from "@/src/server/db/prisma";

async function main() {
  await prisma.$queryRawUnsafe("SELECT 1");
  console.log("ok");
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(String((error as Error).message));
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});

