import { PrismaClient } from "@prisma/client";
import fs from "node:fs";

const p = new PrismaClient();
const jobId = "cmtqhz77p000fun84lgcyuckv";

async function main() {
  const rounds = await p.autoRoundRun.findMany({ where: { jobId }, orderBy: { roundNo: "asc" } });
  const rows = rounds.map((r) => {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const rt = (meta.runtime ?? {}) as Record<string, unknown>;
    const tl = Array.isArray(rt.timeline) ? rt.timeline : [];
    const symbolSelected = tl.find((e: { step?: string }) => e.step === "SYMBOL_SELECTED") as
      | { at?: string; symbol?: string }
      | undefined;
    const durationSec =
      r.endedAt && r.startedAt ? Math.round((r.endedAt.getTime() - r.startedAt.getTime()) / 1000) : null;
    return {
      roundNo: r.roundNo,
      runId: r.id,
      state: r.state,
      symbol: r.symbol,
      result: r.result,
      failReason: r.failReason,
      terminalReason: meta.terminalReason,
      closeReason: meta.closeReason,
      runtimeStep: rt.step,
      durationSec,
      executionId: r.executionId,
      buyPrice: r.buyPrice,
      aiFinalDecision: meta.aiFinalDecision,
      aiConsensusDecision: meta.aiConsensusDecision,
      aiVetoStatus: meta.aiVetoStatus,
      symbolSelectedAt: symbolSelected?.at ?? meta.coinSelectedAt,
      progressExecution: (meta.progressBreakdown as { execution?: number } | undefined)?.execution ?? rt.progressBreakdown?.execution,
      lastReject: meta.lastRejectReason ?? meta.rejectReason,
    };
  });
  const outPath =
    "artifacts/paper-campaigns/paper-8h-2026-09-07T0012Z/_forensic-round-summary.json";
  fs.writeFileSync(outPath, JSON.stringify({ roundCount: rows.length, rows }, null, 2), "utf8");
  console.log("written", outPath);
  await p.$disconnect();
}

main();
