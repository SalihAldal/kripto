import { beginSettlementMode, getSettlementStatus } from "@/src/server/shadow-outcome/finalizer.service";

async function main() {
  const runId = String(process.argv[2] ?? "").trim();
  if (!runId) {
    process.stderr.write("Usage: tsx scripts/phase07-settlement-mode.ts <runId>\n");
    process.exit(1);
  }
  const mode = beginSettlementMode(runId);
  const status = await getSettlementStatus(runId);
  process.stdout.write(`${JSON.stringify({ mode, status }, null, 2)}\n`);
}

void main();
