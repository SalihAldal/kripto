import { PrismaClient } from "@prisma/client";

async function main() {
  const p = new PrismaClient();
  const open = await p.autoRoundRun.findMany({
    where: { endedAt: null },
    orderBy: { startedAt: "desc" },
    take: 10,
  });
  console.log(JSON.stringify(open, null, 2));
  await p.$disconnect();
}

main();
