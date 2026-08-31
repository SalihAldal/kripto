import { PrismaClient } from "@prisma/client";

async function main() {
  const p = new PrismaClient();
  const since = new Date(Date.now() - 2 * 60 * 60_000);
  const recent = await p.autoRoundJob.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
  });
  console.log(JSON.stringify(recent, null, 2));
  await p.$disconnect();
}

main();
