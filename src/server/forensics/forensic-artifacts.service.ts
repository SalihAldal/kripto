import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ForensicSessionContext } from "@/src/server/forensics/forensic-context";
import { buildNativePaperDiagnostics } from "@/src/server/forensics/native-paper-diagnostics.service";

export type ForensicArtifactBundle = {
  sessionId: string;
  rootDir: string;
  summaryPaths: {
    scannerCycle: string;
    candidateTrace: string;
    nativePaperDiagnostics: string;
    simulationIntegrity: string;
    resolvedConfig: string;
  };
};

function writeJson(filePath: string, payload: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function exportForensicArtifacts(
  session: ForensicSessionContext,
  rootDir = path.join(process.cwd(), "artifacts", "forensics", session.sessionId),
): ForensicArtifactBundle {
  const roundsDir = path.join(rootDir, "rounds");
  const candidatesDir = path.join(rootDir, "candidates");
  const tradesDir = path.join(rootDir, "trades");
  mkdirSync(roundsDir, { recursive: true });
  mkdirSync(candidatesDir, { recursive: true });
  mkdirSync(tradesDir, { recursive: true });

  const scannerCyclePath = path.join(rootDir, "scanner-cycle.json");
  const candidateTracePath = path.join(rootDir, "candidate-trace.json");
  const diagnosticsPath = path.join(rootDir, "native-paper-diagnostics.json");
  const simIntegrityPath = path.join(rootDir, "simulation-integrity.json");
  const resolvedConfigPath = path.join(rootDir, "resolved-config.json");

  writeJson(scannerCyclePath, {
    cycles: session.scannerCycles,
    latest: session.scannerCycles[session.scannerCycles.length - 1] ?? null,
  });
  writeJson(candidateTracePath, {
    candidates: session.candidates,
    terminals: session.terminals,
  });
  writeJson(diagnosticsPath, buildNativePaperDiagnostics(session));
  writeJson(simIntegrityPath, session.simulationIntegrity ?? { passed: true, violations: [] });
  writeJson(resolvedConfigPath, { note: "Use resolveRuntimeConfigSnapshot() at session start" });

  if (session.roundId) {
    writeJson(path.join(roundsDir, `${session.roundId}.json`), {
      roundId: session.roundId,
      jobId: session.jobId,
      runId: session.runId,
      decisions: session.decisions,
      consensus: session.consensus,
      evAudits: session.evAudits,
      riskSizing: session.riskSizing,
    });
  }

  for (const candidate of session.candidates.slice(0, 100)) {
    writeJson(path.join(candidatesDir, `${candidate.candidateId}.json`), candidate);
  }
  for (const [idx, order] of session.orders.entries()) {
    writeJson(path.join(tradesDir, `order-${idx + 1}.json`), order);
  }
  for (const [idx, pnl] of session.pnlEntries.entries()) {
    writeJson(path.join(tradesDir, `pnl-${idx + 1}.json`), pnl);
  }

  writeJson(path.join(rootDir, "session-summary.json"), {
    sessionId: session.sessionId,
    mode: session.mode,
    startedAt: session.startedAt,
    counts: {
      terminals: session.terminals.length,
      candidates: session.candidates.length,
      orders: session.orders.length,
      pnlEntries: session.pnlEntries.length,
    },
    rejectionCountsByStage: session.rejectionCountsByStage,
    rejectionCountsByReason: session.rejectionCountsByReason,
    sessionState: session.sessionState ?? null,
  });

  return {
    sessionId: session.sessionId,
    rootDir,
    summaryPaths: {
      scannerCycle: scannerCyclePath,
      candidateTrace: candidateTracePath,
      nativePaperDiagnostics: diagnosticsPath,
      simulationIntegrity: simIntegrityPath,
      resolvedConfig: resolvedConfigPath,
    },
  };
}
