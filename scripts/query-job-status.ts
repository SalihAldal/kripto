import { prisma } from "@/src/server/db/prisma";

async function main() {
  const jobId = process.argv[2] ?? "cmst8nza40007unvsi2211emo";
  const job = await prisma.autoRoundJob.findUnique({
    where: { id: jobId },
    include: { rounds: { orderBy: { roundNo: "asc" } } },
  });
  console.log(JSON.stringify(job, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
