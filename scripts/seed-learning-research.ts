import "./load-dotenv.cjs";
import { researchSeedRecords } from "../src/server/learning-engine/research-seed";
async function main() {
  const args = process.argv.slice(2);
  if (args.some(a => a !== "--check")) throw new Error("USAGE: learning:seed [--check]");
  if (args.includes("--check")) { console.log(JSON.stringify({ validAvailableRecords: researchSeedRecords().length, trainingEligible: false })); return; }
  const { prisma } = await import("../src/server/db/prisma");
  try { const { syncResearchSeedKnowledge } = await import("../src/server/learning-engine/research-seed.service"); console.log(JSON.stringify(await syncResearchSeedKnowledge())); }
  finally { await prisma.$disconnect(); }
}
main().catch(e => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
