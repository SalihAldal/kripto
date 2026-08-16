import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  exportRoundForensicArtifacts,
  type RoundForensicExportInput,
} from "@/src/server/forensics/round-forensic-export.service";
import { logger } from "@/lib/logger";

export type ForensicExportStatus = "COMPLETED" | "FAILED";

export type ForensicExportResult = {
  exportStatus: ForensicExportStatus;
  rootDir?: string;
  exportKind?: string;
  availableArtifacts: string[];
  failedArtifacts: string[];
  errorCode?: string;
  errorMessage?: string;
};

function stackDigest(error: Error) {
  return createHash("sha256").update(error.stack ?? error.message).digest("hex").slice(0, 16);
}

function writeExportError(input: {
  rootDir: string;
  roundId: string;
  runId: string;
  exportKind: string;
  error: Error;
  availableArtifacts: string[];
  failedArtifacts: string[];
}) {
  mkdirSync(input.rootDir, { recursive: true });
  writeFileSync(
    path.join(input.rootDir, "export-error.json"),
    `${JSON.stringify(
      {
        roundId: input.roundId,
        runId: input.runId,
        timestamp: new Date().toISOString(),
        exportKind: input.exportKind,
        exportStatus: "FAILED",
        errorCode: input.error.name || "EXPORT_FAILED",
        errorMessage: input.error.message,
        stackDigest: stackDigest(input.error),
        availableArtifacts: input.availableArtifacts,
        failedArtifacts: input.failedArtifacts,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function listExistingArtifacts(rootDir: string) {
  if (!existsSync(rootDir)) return [];
  return readdirSync(rootDir).filter((name) => name.endsWith(".json"));
}

/**
 * Best-effort forensic export with observable failure reporting.
 * Does not throw — business failure reason must remain authoritative.
 */
export async function runRoundForensicExport(input: RoundForensicExportInput): Promise<ForensicExportResult> {
  const rootDir = path.join(
    process.cwd(),
    "artifacts",
    "forensics",
    input.session.sessionId,
    "rounds",
    input.roundId,
  );
  const exportKind = input.failReason ? "failed-round-partial" : "completed-round-full";

  try {
    const result = await exportRoundForensicArtifacts(input);
    const availableArtifacts = listExistingArtifacts(result.rootDir);
    logger.info(
      {
        jobId: input.jobId,
        runId: input.runId,
        roundId: input.roundId,
        exportStatus: "COMPLETED",
        exportKind,
        artifactCount: availableArtifacts.length,
      },
      "Round forensic export completed",
    );
    return {
      exportStatus: "COMPLETED",
      rootDir: result.rootDir,
      exportKind: String(result.summary.exportKind ?? exportKind),
      availableArtifacts,
      failedArtifacts: [],
    };
  } catch (error) {
    const err = error as Error;
    const availableArtifacts = listExistingArtifacts(rootDir);
    writeExportError({
      rootDir,
      roundId: input.roundId,
      runId: input.runId,
      exportKind,
      error: err,
      availableArtifacts,
      failedArtifacts: ["round-summary.json", "recovery-decisions.json", "recovery-telemetry.json"],
    });
    logger.error(
      {
        jobId: input.jobId,
        runId: input.runId,
        roundId: input.roundId,
        exportStatus: "FAILED",
        exportKind,
        errorMessage: err.message,
        stackDigest: stackDigest(err),
      },
      "Round forensic export failed",
    );
    return {
      exportStatus: "FAILED",
      rootDir,
      exportKind,
      availableArtifacts: [...availableArtifacts, "export-error.json"],
      failedArtifacts: ["round-summary.json", "recovery-decisions.json", "recovery-telemetry.json"],
      errorCode: err.name || "EXPORT_FAILED",
      errorMessage: err.message,
    };
  }
}
