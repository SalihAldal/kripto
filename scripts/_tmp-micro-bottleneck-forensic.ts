import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/src/server/db/prisma";
import { buildMicroBottleneckForensic } from "@/src/server/forensics/micro-bottleneck-forensic.service";

function readValidation() {
  const p = path.join(process.cwd(), "kripto-10round-paper-validation.json");
  return JSON.parse(fs.readFileSync(p, "utf8")) as {
    sessionId: string;
    startedAt: string;
    completedAt: string;
    shadow?: { movers?: number };
    handoffDiagnostic?: { moverEvents?: number };
  };
}

async function main() {
  const validation = readValidation();
  const startedAt = new Date(validation.startedAt);
  const completedAt = new Date(validation.completedAt);
  const moverTarget = Number(validation.shadow?.movers ?? validation.handoffDiagnostic?.moverEvents ?? 6);
  const output = await buildMicroBottleneckForensic({
    startedAt,
    completedAt,
    moverTarget,
  });

  const out = path.join(process.cwd(), "artifacts", "forensics", "micro-bottleneck-forensic.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(out);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error((error as Error).message);
  await prisma.$disconnect();
  process.exit(1);
});
