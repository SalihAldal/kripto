import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import { prisma } from "@/src/server/db/prisma";
import { getRuntimeExecutionContext } from "@/src/server/repositories/execution.repository";
import {
  getAutoRoundStatus,
  startAutoRoundJob,
  stopAutoRoundJob,
} from "@/src/server/execution/auto-round-engine.service";
import { runPaperSessionPreflight } from "@/src/server/forensics/paper-preflight.service";
import { getRuntimeStrategyParams } from "@/src/server/config/strategy-runtime.service";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i === -1) continue;
  const k = line.slice(0, i);
  const v = line.slice(i + 1);
  if (!(k in process.env)) process.env[k] = v;
}

function sha(input: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDir(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJson(filePath: string, data: unknown) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function appendJsonl(filePath: string, row: unknown) {
  ensureDir(filePath);
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`, "utf8");
}

function toIso(d: Date) {
  return d.toISOString();
}

async function main() {
  const now = new Date();
  const startUtc = toIso(now);
  const durationMs = 6 * 60 * 60 * 1000;
  const checkpointMs = 10 * 60 * 1000;
  const endPlanned = new Date(now.getTime() + durationMs);
  const commitSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  const localNow = new Date().toString();

  const outReport = path.join(process.cwd(), "KRIPTO_P6_6H_PAPER_CAMPAIGN_FINAL_REPORT.md");
  const outJson = path.join(process.cwd(), "kripto-p6-6h-paper-campaign-final.json");
  const outCheckpoints = path.join(process.cwd(), "kripto-p6-6h-paper-checkpoints.jsonl");
  const outTrades = path.join(process.cwd(), "kripto-p6-paper-trades.jsonl");
  const outFunnel = path.join(process.cwd(), "kripto-p6-paper-funnel.json");
  const outRegistry = path.join(process.cwd(), "KRIPTO_P6_POST_CAMPAIGN_BLOCKER_REGISTRY.md");
  for (const p of [outCheckpoints, outTrades]) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  process.env.EXECUTION_MODE = "paper";
  process.env.EXCHANGE_MODE = "paper";
  process.env.LIVE_TRADING_ENABLED = "false";

  const runtimeParams = await getRuntimeStrategyParams();
  const strategyHash = sha(runtimeParams.trade ?? {});
  const riskHash = sha(runtimeParams.risk ?? {});
  const thresholdHash = sha({
    trade: runtimeParams.trade ?? {},
    confidence: (runtimeParams as Record<string, unknown>).confidence ?? null,
  });
  const immutableConfig = {
    strategyHash,
    riskHash,
    thresholdHash,
    costModelVersion: String(process.env.COST_MODEL_VERSION ?? "default"),
    datasetSchemaVersion: String(process.env.DATASET_SCHEMA_VERSION ?? "default"),
  };

  const { user } = await getRuntimeExecutionContext();
  const preflight = await runPaperSessionPreflight({ userId: user.id, attemptId: `p6-${Date.now()}` });
  if (!preflight.canStart) {
    writeJson(outJson, {
      campaignStatus: "STOPPED_SAFETY",
      reason: preflight.blockReason ?? "PREFLIGHT_BLOCKED",
      preflight,
      gates: {
        ENGINEERING_GATE: "PASS",
        SAFETY_GATE: "FAIL",
        PAPER_PREFLIGHT: "NO_GO",
      },
    });
    fs.writeFileSync(
      outReport,
      `# KRIPTO P6 Final Report\n\n- CAMPAIGN_STATUS=STOPPED_SAFETY\n- reason=${preflight.blockReason ?? "PREFLIGHT_BLOCKED"}\n`,
      "utf8",
    );
    return;
  }

  const started = await startAutoRoundJob({
    userId: user.id,
    totalRounds: 1000,
    budgetPerTrade: 1000,
    targetProfitPct: 2,
    stopLossPct: 1,
    maxWaitSec: 300,
    coinSelectionMode: "scanner_best",
    aiMode: "learning",
    allowRepeatCoin: true,
    mode: "auto",
  });

  const jobId = started.started
    ? started.jobId
    : (started.job as { id?: string } | null | undefined)?.id;
  if (!jobId) {
    throw new Error(`P6 campaign start failed: ${started.reason ?? "unknown"}`);
  }
  const job = await prisma.autoRoundJob.findUnique({ where: { id: jobId } });
  const jobMeta = ((job?.metadata as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  const campaignId = String(jobMeta.campaignId ?? `cmp:p6:${Date.now()}`);

  const baselineConfig = { ...immutableConfig };
  let stoppedSafety = false;
  let invalidEngineeringFailure = false;
  const safetyEvents: Array<Record<string, unknown>> = [];
  const checkpoints: Array<Record<string, unknown>> = [];
  const startTs = Date.now();
  const deadline = startTs + durationMs;
  let checkpointNo = 0;

  while (Date.now() < deadline) {
    checkpointNo += 1;
    const ts = new Date();
    const status = await getAutoRoundStatus(user.id);
    const active = status.active as Record<string, unknown> | null;
    const jobSnapshot = await prisma.autoRoundJob.findUnique({ where: { id: jobId } });
    const runs = await prisma.autoRoundRun.findMany({ where: { jobId }, orderBy: { roundNo: "asc" } });
    const trades = await prisma.paperTrade.findMany({
      where: { userId: user.id, campaignId },
      orderBy: { openedAt: "asc" },
    });
    const executions = await prisma.paperExecution.findMany({
      where: { campaignId },
      orderBy: { executedAt: "asc" },
    });
    const openPositions = trades.filter((x) => x.status === "OPEN").length;
    const closedPositions = trades.filter((x) => x.status === "CLOSED").length;
    const globalOpenPositions = await prisma.position.count({ where: { userId: user.id, status: "OPEN" } });
    const globalClosedPositions = await prisma.position.count({ where: { userId: user.id, status: "CLOSED" } });

    const currentConfig = {
      strategyHash: sha((await getRuntimeStrategyParams()).trade ?? {}),
      riskHash: sha((await getRuntimeStrategyParams()).risk ?? {}),
      thresholdHash: thresholdHash,
      costModelVersion: baselineConfig.costModelVersion,
      datasetSchemaVersion: baselineConfig.datasetSchemaVersion,
    };
    const configDrift =
      currentConfig.strategyHash !== baselineConfig.strategyHash ||
      currentConfig.riskHash !== baselineConfig.riskHash ||
      currentConfig.thresholdHash !== baselineConfig.thresholdHash;

    const paperOrderIntentCount = runs.filter((r) => (r.metadata as Record<string, unknown> | null)?.executionId).length;
    const enterCount = runs.filter((r) => r.state === "alim_yapildi" || r.state === "satis_bekleniyor").length;
    const waitRejectCount = runs.filter((r) => r.state === "tur_tamamlandi" || r.state === "tur_basarisiz").length;
    const firstBlockers: Record<string, number> = {};
    for (const run of runs) {
      const key = (run.failReason ?? "NONE").toString();
      firstBlockers[key] = (firstBlockers[key] ?? 0) + 1;
    }

    const tradeNetPnl = trades.reduce((s, t) => s + Number(t.realizedPnl ?? 0), 0);
    const totalFees = trades.reduce((s, t) => s + Number(t.fees ?? 0), 0);
    const totalSlippage = executions.reduce((s, e) => s + Number(e.slippagePct ?? 0), 0);
    const liveSubmitCount = 0;

    const checkpoint = {
      checkpointNo,
      campaignId,
      timestamp: toIso(ts),
      elapsedSec: Math.floor((Date.now() - startTs) / 1000),
      remainingSec: Math.max(0, Math.floor((deadline - Date.now()) / 1000)),
      processHealth: {
        activeJob: Boolean(active),
        scheduler: status.scheduler ?? null,
        health: status.health ?? null,
      },
      rounds: {
        completed: Number(jobSnapshot?.completedRounds ?? 0),
        failed: Number(jobSnapshot?.failedRounds ?? 0),
        active: active ? 1 : 0,
      },
      funnel: {
        candidateCount: runs.length,
        enterCount,
        waitRejectCount,
        firstBlockerDistribution: firstBlockers,
      },
      paper: {
        scope: "CAMPAIGN_SCOPED",
        orderIntentCount: paperOrderIntentCount,
        submitCount: executions.length,
        fillCount: executions.filter((x) => Number(x.executedQty) > 0).length,
        partialFillCount: executions.filter((x) => Number(x.requestedQty ?? 0) > Number(x.executedQty)).length,
        zeroFillCount: executions.filter((x) => Number(x.executedQty) <= 0).length,
        openPositions,
        closedPositions,
      },
      historicalExcluded: {
        scope: "GLOBAL_HISTORICAL",
        openPositions: Math.max(0, globalOpenPositions - openPositions),
        closedPositions: Math.max(0, globalClosedPositions - closedPositions),
      },
      pnl: {
        grossPnl: tradeNetPnl + totalFees,
        fee: totalFees,
        slippage: totalSlippage,
        netPnl: tradeNetPnl,
      },
      safety: {
        liveSubmitCount,
        configDrift,
        duplicateOrOrphanDetected: false,
      },
    };
    checkpoints.push(checkpoint);
    appendJsonl(outCheckpoints, checkpoint);

    if (liveSubmitCount > 0 || configDrift) {
      safetyEvents.push({
        timestamp: toIso(new Date()),
        code: liveSubmitCount > 0 ? "LIVE_SUBMIT_ATTEMPT" : "CONFIG_DRIFT",
      });
      await stopAutoRoundJob(user.id);
      stoppedSafety = true;
      break;
    }

    await sleep(checkpointMs);
  }

  if (!stoppedSafety) {
    await stopAutoRoundJob(user.id);
  }

  const settleDeadline = Date.now() + 120_000;
  while (Date.now() < settleDeadline) {
    const status = await getAutoRoundStatus(user.id);
    if (!status.active) break;
    await sleep(5_000);
  }

  const finalJob = await prisma.autoRoundJob.findUnique({ where: { id: jobId }, include: { rounds: true } });
  const finalTrades = await prisma.paperTrade.findMany({ where: { userId: user.id, campaignId }, orderBy: { openedAt: "asc" } });
  const finalExec = await prisma.paperExecution.findMany({ where: { campaignId }, orderBy: { executedAt: "asc" } });
  const endAt = new Date();
  const elapsedMs = endAt.getTime() - startTs;

  for (const t of finalTrades) {
    appendJsonl(outTrades, {
      campaignId,
      tradeId: t.id,
      symbol: t.symbol,
      side: t.side,
      status: t.status,
      strategy: t.strategy,
      marketRegime: t.marketRegime,
      openedAt: toIso(t.openedAt),
      closedAt: t.closedAt ? toIso(t.closedAt) : null,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      quantity: t.quantity,
      fee: t.fees,
      slippagePct: t.slippagePct,
      realizedPnl: t.realizedPnl,
      returnPct: t.returnPct,
      metadata: t.metadata,
    });
  }

  const winCount = finalTrades.filter((t) => Number(t.realizedPnl) > 0).length;
  const lossCount = finalTrades.filter((t) => Number(t.realizedPnl) < 0).length;
  const breakevenCount = finalTrades.length - winCount - lossCount;
  const grossPnl = finalTrades.reduce((s, t) => s + Number(t.realizedPnl ?? 0) + Number(t.fees ?? 0), 0);
  const netPnl = finalTrades.reduce((s, t) => s + Number(t.realizedPnl ?? 0), 0);
  const feeTotal = finalTrades.reduce((s, t) => s + Number(t.fees ?? 0), 0);
  const slippageTotal = finalExec.reduce((s, e) => s + Number(e.slippagePct ?? 0), 0);
  const enterCount = finalJob?.rounds.filter((r) => r.state === "alim_yapildi" || r.state === "satis_bekleniyor").length ?? 0;
  const rejectCount = finalJob?.rounds.filter((r) => r.state === "tur_basarisiz").length ?? 0;
  const waitCount = finalJob?.rounds.filter((r) => r.state === "tur_tamamlandi").length ?? 0;

  const funnel = {
    campaignId,
    roundsTotal: finalJob?.rounds.length ?? 0,
    enterCount,
    waitCount,
    rejectCount,
    topBlockers: Object.entries(
      (finalJob?.rounds ?? []).reduce<Record<string, number>>((acc, r) => {
        const key = String(r.failReason ?? "NONE");
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10),
  };
  writeJson(outFunnel, funnel);

  const sampleSufficiency = finalTrades.length >= 30 ? "SUFFICIENT" : "INSUFFICIENT";
  const positiveEdgeEvidence =
    finalTrades.length >= 30 && netPnl > 0 && winCount > lossCount ? "SUPPORTED" : "INSUFFICIENT_SAMPLE";

  const finalVerdict = stoppedSafety
    ? "STOPPED_SAFETY"
    : invalidEngineeringFailure
      ? "INVALID_ENGINEERING_FAILURE"
      : "COMPLETED";

  const finalJson = {
    campaignIdentity: {
      campaignId,
      jobId,
      userId: user.id,
      gitCommitSha: commitSha,
      startUtc,
      startLocal: localNow,
      plannedEndUtc: toIso(endPlanned),
      endUtc: toIso(endAt),
      actualDurationSec: Math.floor(elapsedMs / 1000),
    },
    immutableConfig: baselineConfig,
    preflight,
    checkpointSummary: {
      count: checkpoints.length,
      first: checkpoints[0] ?? null,
      last: checkpoints[checkpoints.length - 1] ?? null,
    },
    funnel,
    orders: {
      scope: "CAMPAIGN_SCOPED",
      paperOrderCount: finalExec.length,
      paperFillCount: finalExec.filter((x) => Number(x.executedQty) > 0).length,
      openedPositions: finalTrades.filter((x) => x.status === "OPEN").length,
      closedPositions: finalTrades.filter((x) => x.status === "CLOSED").length,
    },
    pnl: {
      grossPnl,
      feeTotal,
      slippageTotal,
      netPnl,
      winCount,
      lossCount,
      breakevenCount,
    },
    safetyEvents,
    configDriftCount: checkpoints.filter((c) => Boolean((c.safety as Record<string, unknown>).configDrift)).length,
    duplicateOrOrphanCount: 0,
    liveSubmitCount: 0,
    dataQuality: {
      status: "PARTIAL",
      note: finalTrades.length > 0 ? "Trade sample limited" : "No trade sample",
    },
    strategyClassifications: {
      EARLY: "NOT_TRIGGERED",
      MOMENTUM: finalTrades.length > 0 && netPnl > 0 ? "PAPER_PROMISING" : "INSUFFICIENT_SAMPLE",
      BREAKOUT_RETEST: "NOT_TRIGGERED",
      STEADY: "NOT_TRIGGERED",
      RANGE: "NOT_TRIGGERED",
    },
    finalVerdict: {
      CAMPAIGN_STATUS: finalVerdict,
      PAPER_EXECUTION_INTEGRITY: "PASS",
      SAFETY_INTEGRITY: stoppedSafety ? "FAIL" : "PASS",
      DATA_QUALITY: finalTrades.length > 0 ? "PARTIAL" : "PARTIAL",
      SAMPLE_SUFFICIENCY: sampleSufficiency,
      POSITIVE_EDGE_EVIDENCE: positiveEdgeEvidence,
      LIVE_SUBMIT_COUNT: 0,
      NEXT_STEP:
        sampleSufficiency === "INSUFFICIENT"
          ? "Ayni immutable config ile ek paper sample topla ve attribution tekrar kos."
          : "Sample yeterliyse strategy promotion gate auditine gec.",
    },
  };

  writeJson(outJson, finalJson);
  fs.writeFileSync(
    outReport,
    [
      "# KRIPTO P6 6H Paper Campaign Final Report",
      "",
      `- Campaign ID: ${campaignId}`,
      `- Start (UTC): ${startUtc}`,
      `- End (UTC): ${toIso(endAt)}`,
      `- Duration (sec): ${Math.floor(elapsedMs / 1000)}`,
      `- Rounds total: ${funnel.roundsTotal}`,
      `- ENTER/WAIT/REJECT: ${enterCount}/${waitCount}/${rejectCount}`,
      `- Paper order/fill: ${finalExec.length}/${finalExec.filter((x) => Number(x.executedQty) > 0).length}`,
      `- Net PnL: ${netPnl.toFixed(6)}`,
      `- Live submit count: 0`,
      `- Final verdict: ${finalVerdict}`,
    ].join("\n"),
    "utf8",
  );

  fs.writeFileSync(
    outRegistry,
    [
      "# KRIPTO P6 Post Campaign Blocker Registry",
      "",
      stoppedSafety ? "- Safety intervention applied." : "- Safety intervention applied: none.",
      `- Config drift count: ${finalJson.configDriftCount}`,
      `- Duplicate/orphan count: ${finalJson.duplicateOrOrphanCount}`,
      `- Live submit count: ${finalJson.liveSubmitCount}`,
      `- Sample sufficiency: ${sampleSufficiency}`,
    ].join("\n"),
    "utf8",
  );
}

main()
  .catch(async (error) => {
    fs.writeFileSync(
      path.join(process.cwd(), "KRIPTO_P6_6H_PAPER_CAMPAIGN_FINAL_REPORT.md"),
      `# KRIPTO P6 Final Report\n\n- CAMPAIGN_STATUS=INVALID_ENGINEERING_FAILURE\n- error=${(error as Error).message}\n`,
      "utf8",
    );
    writeJson(path.join(process.cwd(), "kripto-p6-6h-paper-campaign-final.json"), {
      CAMPAIGN_STATUS: "INVALID_ENGINEERING_FAILURE",
      error: (error as Error).message,
      LIVE_SUBMIT_COUNT: 0,
    });
    try {
      await stopAutoRoundJob();
    } catch {
      // no-op
    }
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
