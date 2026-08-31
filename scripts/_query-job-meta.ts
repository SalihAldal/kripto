import { PrismaClient } from "@prisma/client";

async function main() {
  const p = new PrismaClient();
  const jobId = process.argv[2] ?? "cmt4zxkbm001gun8ghz4qsb0w";
  const job = await p.autoRoundJob.findUnique({ where: { id: jobId } });
  console.log(JSON.stringify(job, null, 2));
  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
