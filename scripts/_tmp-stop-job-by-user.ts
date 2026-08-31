import { stopAutoRoundJob } from "@/src/server/execution/auto-round-engine.service";

async function main() {
  const userId = "cmpbhrfn10000un90aroynt6t";
  const result = await stopAutoRoundJob(userId);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
