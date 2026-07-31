import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { prisma } from "@/src/server/db/prisma";
import {
  HOT_PATH_INTEGRATION_PATTERNS,
  HOT_PATH_STAGES,
} from "@/src/server/hot-path/hot-path.registry";
import type {
  HotPathAuditResult,
  HotPathStageAudit,
  HotPathStageStatus,
} from "@/src/server/hot-path/hot-path.types";
import type { WorkerRuntimeSnapshot } from "@/src/server/hot-path/hot-path.types";

const ROOT = process.cwd();

async function fileExists(relativePath: string) {
  try {
    await access(path.join(ROOT, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function fileContains(relativePath: string, pattern: string) {
  try {
    const content = await readFile(path.join(ROOT, relativePath), "utf8");
    return content.includes(pattern);
  } catch {
    return false;
  }
}

function deriveStageStatus(
  modulesMissing: string[],
  integrationSignals: Array<{ found: boolean; id: string }>,
  gaps: string[],
): HotPathStageStatus {
  if (modulesMissing.length > 0) return "MISSING";
  const requiredSignals = integrationSignals.filter((s) => !s.id.includes("not-wired"));
  const requiredMissing = requiredSignals.some((s) => !s.found);
  if (gaps.length > 0 || requiredMissing) {
    return integrationSignals.some((s) => s.found) ? "PARTIAL" : "NOT_WIRED";
  }
  return "CONNECTED";
}

export async function auditHotPathStage(relativeModulePaths: string[], stageId: string): Promise<HotPathStageAudit> {
  const stage = HOT_PATH_STAGES.find((s) => s.id === stageId);
  if (!stage) {
    throw new Error(`Unknown hot path stage: ${stageId}`);
  }

  const modulesPresent: string[] = [];
  const modulesMissing: string[] = [];
  for (const modulePath of stage.modulePaths) {
    if (await fileExists(modulePath)) {
      modulesPresent.push(modulePath);
    } else {
      modulesMissing.push(modulePath);
    }
  }

  const stagePatterns = HOT_PATH_INTEGRATION_PATTERNS.filter((p) => p.stageId === stage.id);
  const integrationSignals = await Promise.all(
    stagePatterns.map(async (entry) => ({
      id: entry.id,
      path: entry.path,
      pattern: entry.pattern,
      found: await fileContains(entry.path, entry.pattern),
    })),
  );

  const gaps: string[] = [];
  for (const signal of integrationSignals) {
    if (signal.id.endsWith("not-wired") && !signal.found) {
      gaps.push(`${signal.id}: module not integrated in ${signal.path}`);
    }
  }

  const status = deriveStageStatus(modulesMissing, integrationSignals, gaps);

  return {
    id: stage.id,
    label: stage.label,
    status,
    modulesPresent,
    modulesMissing,
    integrationSignals: integrationSignals.map(({ path: filePath, pattern, found }) => ({
      path: filePath,
      pattern,
      found,
    })),
    gaps,
  };
}

export async function runHotPathAudit(workers: WorkerRuntimeSnapshot[]): Promise<HotPathAuditResult> {
  const stages = await Promise.all(HOT_PATH_STAGES.map((stage) => auditHotPathStage(stage.modulePaths, stage.id)));

  const integrationGaps = stages.flatMap((stage) =>
    stage.gaps.map((gap) => `${stage.id}: ${gap}`),
  );

  const failedStages = stages.filter((s) => s.status === "MISSING" || s.status === "NOT_WIRED").length;
  const partialStages = stages.filter((s) => s.status === "PARTIAL").length;

  let overallStatus: HotPathAuditResult["overallStatus"] = "PASS";
  if (failedStages > 0) overallStatus = "FAIL";
  else if (partialStages > 0 || integrationGaps.length > 0) overallStatus = "WARN";

  const activeWorkerCount = workers.filter((w) => w.enabled && w.running).length;
  const frozenWorkerCount = workers.filter((w) => !w.enabled).length;

  const generatedAt = new Date().toISOString();
  const auditKey = `hpa_${createHash("sha256").update(`${generatedAt}_${overallStatus}`).digest("hex").slice(0, 16)}`;

  const result: HotPathAuditResult = {
    auditKey,
    overallStatus,
    generatedAt,
    stages,
    integrationGaps,
    workerPolicy: {
      freezeEnabled: env.HOT_PATH_V2_FREEZE_ENABLED,
      legacyWorkersEnabled: env.HOT_PATH_LEGACY_WORKERS_ENABLED,
      maxCriticalWorkers: env.HOT_PATH_MAX_CRITICAL_WORKERS,
      activeWorkerCount,
      frozenWorkerCount,
    },
    workers,
  };

  await persistHotPathAuditSnapshot(result).catch((error) => {
    logger.warn({ error: (error as Error).message }, "Hot path audit snapshot persist failed");
  });

  return result;
}

export async function persistHotPathAuditSnapshot(result: HotPathAuditResult) {
  return prisma.hotPathAuditSnapshot.create({
    data: {
      auditKey: result.auditKey,
      overallStatus: result.overallStatus,
      hotPathStages: result.stages,
      workerPolicy: result.workerPolicy,
      integrationGaps: result.integrationGaps,
      workerCount: result.workerPolicy.activeWorkerCount,
      frozenWorkerCount: result.workerPolicy.frozenWorkerCount,
      metadata: { workers: result.workers },
    },
  });
}

export async function getLatestHotPathAuditSnapshot() {
  return prisma.hotPathAuditSnapshot.findFirst({
    orderBy: { generatedAt: "desc" },
  });
}

export async function listHotPathAuditSnapshots(limit = 20) {
  return prisma.hotPathAuditSnapshot.findMany({
    orderBy: { generatedAt: "desc" },
    take: limit,
    select: {
      id: true,
      auditKey: true,
      overallStatus: true,
      workerCount: true,
      frozenWorkerCount: true,
      integrationGaps: true,
      generatedAt: true,
    },
  });
}
