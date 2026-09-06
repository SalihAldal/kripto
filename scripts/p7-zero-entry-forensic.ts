import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { prisma } from "@/src/server/db/prisma";
import { evaluateRecoveryAssessment, resolveTerminalEvidence, summarizeFunnel, type AssessmentCheck, type FunnelEvent } from "@/src/server/forensics/er01-telemetry-verdict";

function ensureDir(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJson(filePath: string, payload: unknown) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeMd(filePath: string, lines: string[]) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function parseArgs() {
  const args = process.argv.slice(2);
  const campaignId = args.find((x) => !x.startsWith("--")) ?? "cmp:cmtjfcizg0009un1knvxa9eqe";
  const assessmentId = args.find((x) => x.startsWith("--assessment-id="))?.split("=")[1] ?? `er01-${Date.now()}`;
  const overwrite = args.includes("--overwrite");
  return { campaignId, assessmentId, overwrite };
}

async function main() {
  const { campaignId, assessmentId, overwrite } = parseArgs();
  const commitSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  const outDir = path.join(process.cwd(), "artifacts", "forensics", "assessments", assessmentId);
  fs.mkdirSync(outDir, { recursive: true });

  const rootJson = path.join(process.cwd(), "kripto-p7-zero-entry-forensic.json");
  if (fs.existsSync(rootJson) && !overwrite) {
    throw new Error("Root artifacts exist. Use --overwrite for in-place replacement or read scoped output under assessment dir.");
  }

  const job = await prisma.autoRoundJob.findFirst({
    where: {
      OR: [{ id: campaignId.replace(/^cmp:/, "") }, { metadata: { path: ["campaignId"], equals: campaignId } }],
    },
    include: { rounds: { orderBy: { roundNo: "asc" } } },
  });
  if (!job) throw new Error(`Campaign job not found for ${campaignId}`);

  const jobId = job.id;
  const userId = job.userId;
  const runs = job.rounds;
  const paperExec = await prisma.paperExecution.findMany({ where: { campaignId }, orderBy: { executedAt: "asc" } });
  const paperTrades = await prisma.paperTrade.findMany({ where: { campaignId, userId }, orderBy: { openedAt: "asc" } });

  const events: FunnelEvent[] = [];
  const matrix = runs.map((run) => {
    const metadata = (run.metadata as Record<string, unknown> | null) ?? {};
    const terminal = resolveTerminalEvidence({
      structured: {
        decision: (metadata.canonicalDecision as "ENTER" | "WAIT" | "REJECT" | undefined) ?? null,
        reasonCode: (metadata.firstBlocker as string | undefined) ?? null,
        secondaryReasonCodes: Array.isArray(metadata.secondaryBlockers) ? (metadata.secondaryBlockers as string[]) : [],
        source: metadata.canonicalDecision ? "CANONICAL" : null,
      },
      legacyReason: run.failReason ?? null,
      runState: run.state,
      hasCandidate: Boolean(metadata.candidateId),
      openedPosition: Number(run.buyPrice ?? 0) > 0 && Number(run.buyQty ?? 0) > 0,
      submittedOrder: Boolean(run.executionId),
      fillCount: Number(metadata.fillCount ?? 0),
      executionFailed: run.state === "tur_basarisiz",
    });
    const candidateId = metadata.candidateId ? String(metadata.candidateId) : null;
    const marketDataTimestamp = typeof metadata.marketDataTimestamp === "string" ? metadata.marketDataTimestamp : null;
    const dataAgeMs = metadata.marketDataAgeMs == null ? null : Number(metadata.marketDataAgeMs);
    const decisionId = metadata.decisionId ? String(metadata.decisionId) : null;

    events.push({
      eventId: `${run.id}:round`,
      campaignId,
      roundId: String(run.roundNo),
      candidateId,
      kind: "ROUND",
      timestamp: run.startedAt.toISOString(),
    });
    if (candidateId) {
      events.push({
        eventId: `${run.id}:candidate`,
        campaignId,
        roundId: String(run.roundNo),
        candidateId,
        kind: "CANDIDATE",
        timestamp: run.startedAt.toISOString(),
      });
      if (terminal.decision) {
        events.push({
          eventId: `${run.id}:decision:${decisionId ?? terminal.decision}`,
          campaignId,
          roundId: String(run.roundNo),
          candidateId,
          kind: "CANONICAL_DECISION",
          decision: terminal.decision,
          timestamp: run.endedAt?.toISOString() ?? run.startedAt.toISOString(),
        });
      }
    }
    if (run.executionId) {
      events.push({
        eventId: `${run.id}:intent:${run.executionId}`,
        campaignId,
        roundId: String(run.roundNo),
        candidateId,
        kind: "ORDER_INTENT",
        timestamp: run.startedAt.toISOString(),
        orderId: String(run.executionId),
      });
    }
    return {
      campaignId,
      roundId: String(run.roundNo),
      runId: run.id,
      candidateId,
      symbol: run.symbol ?? null,
      detectionTimestamp: run.startedAt.toISOString(),
      marketDataTimestamp,
      dataAgeMs,
      canonicalTerminalDecision: terminal.decision,
      firstBlocker: terminal.firstBlocker,
      secondaryBlockers: terminal.secondaryBlockers,
      roundOutcome: terminal.roundOutcome,
      evidenceStatus: terminal.evidenceStatus,
      mappingSource: terminal.mappingSource,
      executionOutcome: terminal.executionOutcome,
      orderIntentCreated: Boolean(run.executionId),
      roundState: run.state,
      integrityConflicts: terminal.integrityConflicts,
    };
  });

  for (const exec of paperExec) {
    events.push({
      eventId: `${exec.id}:submit`,
      campaignId,
      candidateId: null,
      kind: "SUBMIT_ATTEMPT",
      timestamp: exec.executedAt.toISOString(),
      orderId: exec.executionId ?? exec.executionKey,
    });
    events.push({
      eventId: `${exec.id}:order`,
      campaignId,
      candidateId: null,
      kind: "ORDER",
      timestamp: exec.executedAt.toISOString(),
      orderId: exec.executionId ?? exec.executionKey,
    });
    if (Number(exec.executedQty) > 0) {
      events.push({
        eventId: `${exec.id}:fill`,
        campaignId,
        candidateId: null,
        kind: "FILL",
        timestamp: exec.executedAt.toISOString(),
        orderId: exec.executionId ?? exec.executionKey,
        fillId: exec.id,
      });
    }
  }
  for (const trade of paperTrades) {
    events.push({
      eventId: `${trade.id}:open`,
      campaignId,
      candidateId: null,
      kind: "POSITION_OPEN",
      timestamp: trade.openedAt.toISOString(),
      positionId: trade.positionId ?? trade.id,
    });
    if (trade.closedAt) {
      events.push({
        eventId: `${trade.id}:close`,
        campaignId,
        candidateId: null,
        kind: "POSITION_CLOSE",
        timestamp: trade.closedAt.toISOString(),
        positionId: trade.positionId ?? trade.id,
      });
    }
  }

  const funnel = summarizeFunnel(events, campaignId);
  const firstBlockerDistribution = matrix.reduce<Record<string, number>>((acc, row) => {
    const key = row.firstBlocker ?? "MISSING";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const checks: AssessmentCheck[] = [
    {
      checkId: "historical-db-read",
      required: true,
      status: "PASS",
      evidenceSource: "autoRoundJob/autoRoundRun/paperExecution/paperTrade",
      inspectedHead: commitSha,
      inspectedWorktreeFingerprint: commitSha,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    },
    {
      checkId: "campaign-preflight-go",
      required: true,
      status: "NOT_RUN",
      evidenceSource: "phase1-policy",
      inspectedHead: commitSha,
      inspectedWorktreeFingerprint: commitSha,
      details: "Phase-1 policy enforces NO_GO for next paper campaign.",
    },
  ];
  const assessment = evaluateRecoveryAssessment(checks);

  const jsonPayload = {
    assessmentId,
    generatedAt: new Date().toISOString(),
    gitCommitSha: commitSha,
    inspectedCampaignId: campaignId,
    campaignWindow: {
      startedAt: job.startedAt.toISOString(),
      endedAt: (job.finishedAt ?? new Date()).toISOString(),
    },
    counts: {
      rounds: runs.length,
      paperExecutionRows: paperExec.length,
      paperTradeRows: paperTrades.length,
    },
    decisionMatrix: matrix,
    firstBlockerDistribution,
    funnel,
    assessment,
    supersedes: {
      previousArtifacts: [
        "KRIPTO_P7_NEXT_6H_PAPER_PREFLIGHT.md",
        "KRIPTO_P7_ZERO_ENTRY_FORENSIC_AND_PAPER_STRATEGY_ACTIVATION.md",
        "kripto-p7-zero-entry-forensic.json",
      ],
      reason: "Old artifacts included non-evidence constants and permissive GO logic.",
    },
  };

  writeJson(path.join(outDir, "kripto-p7-zero-entry-forensic.json"), jsonPayload);
  writeJson(path.join(outDir, "kripto-p7-campaign-scoped-funnel.json"), funnel);
  writeMd(path.join(outDir, "KRIPTO_P7_ZERO_ENTRY_FORENSIC_AND_PAPER_STRATEGY_ACTIVATION.md"), [
    "# KRIPTO P7 Zero Entry Forensic (Assessment Scoped)",
    `- Assessment ID: ${assessmentId}`,
    `- Campaign ID: ${campaignId}`,
    `- Rounds: ${runs.length}`,
    `- Canonical decision events: ${funnel.canonicalDecisionCount}`,
    `- Unique candidates: ${funnel.uniqueCandidateCount}`,
    `- ENTER/WAIT/REJECT events: ${funnel.enterCount}/${funnel.waitCount}/${funnel.rejectCount}`,
    `- Next paper preflight: ${assessment.nextPaperPreflight}`,
  ]);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
