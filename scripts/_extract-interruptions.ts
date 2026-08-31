import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

async function main() {
  const p = new PrismaClient();
  const job = await p.autoRoundJob.findUnique({
    where: { id: "cmt95oqos000bunn4s16m7a37" },
    select: { metadata: true, startedAt: true, finishedAt: true },
  });
  const meta = (job?.metadata ?? {}) as Record<string, unknown>;
  const recoveryAudit = (meta.recoveryAudit as unknown[]) ?? [];
  console.log("recoveryAudit count", recoveryAudit.length);
  const actions = recoveryAudit.map((a) => {
    const x = a as Record<string, unknown>;
    return {
      at: x.timestamp,
      action: x.action,
      result: x.result,
      failure: x.failure,
      message: x.message,
      trigger: x.trigger,
    };
  });
  // summarize by failure type
  const byFailure: Record<string, number> = {};
  for (const a of actions) {
    const k = String(a.failure ?? a.action ?? "unknown");
    byFailure[k] = (byFailure[k] ?? 0) + 1;
  }
  console.log("byFailure", JSON.stringify(byFailure, null, 2));
  console.log("sample last 15", JSON.stringify(actions.slice(-15), null, 2));

  // parse watch log
  const watchPath =
    "C:\\Users\\salih\\.cursor\\projects\\c-Users-salih-Desktop-kripto-main\\terminals\\531016.txt";
  let watchEvents: unknown[] = [];
  try {
    const raw = readFileSync(watchPath, "utf8");
    const lines = raw.split("\n").filter((l) => l.startsWith("{"));
    for (const line of lines) {
      try {
        const j = JSON.parse(line);
        if (j.event === "watch_tick" && (j.blockers?.length || j.recoveryActions?.length)) {
          watchEvents.push({
            at: j.at,
            cycle: j.cycle,
            round: j.currentRound,
            blockers: j.blockers?.map((b: { code: string; message?: string }) => ({
              code: b.code,
              msg: (b.message ?? "").slice(0, 120),
            })),
            recovery: j.recoveryActions,
          });
        }
      } catch {
        /* skip */
      }
    }
  } catch (e) {
    console.log("watch log error", e);
  }
  console.log("watch interruption events", watchEvents.length);
  console.log(JSON.stringify(watchEvents.slice(0, 30), null, 2));
  console.log("--- last 20 ---");
  console.log(JSON.stringify(watchEvents.slice(-20), null, 2));

  await p.$disconnect();
}
main();
