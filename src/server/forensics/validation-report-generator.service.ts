import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

function readJsonIfExists(filePath: string): JsonRecord | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as JsonRecord;
  } catch {
    return null;
  }
}

function resolveRoundDir(runId: string) {
  const root = path.join(process.cwd(), "artifacts", "forensics");
  if (!existsSync(root)) return null;
  const sessions = readdirSync(root, { withFileTypes: true }).filter((row) => row.isDirectory());
  for (const session of sessions) {
    const roundsDir = path.join(root, session.name, "rounds");
    if (!existsSync(roundsDir)) continue;
    const rounds = readdirSync(roundsDir, { withFileTypes: true }).filter((row) => row.isDirectory());
    for (const round of rounds) {
      const summary = readJsonIfExists(path.join(roundsDir, round.name, "round-summary.json"));
      if (summary && String(summary.runId ?? "") === runId) {
        return path.join(roundsDir, round.name);
      }
    }
  }
  return null;
}

function row(label: string, value: unknown) {
  return `- ${label}: ${value == null ? "NOT_RECORDED" : String(value)}`;
}

export function generateValidationReport(runId: string, outputPath?: string) {
  const roundDir = resolveRoundDir(runId);
  if (!roundDir) {
    return {
      runId,
      found: false,
      report: `# Validation Report\n\n- runId: ${runId}\n- status: NOT_RECORDED\n- reason: round artifacts not found\n`,
      outputPath: null,
    };
  }
  const summary = readJsonIfExists(path.join(roundDir, "round-summary.json")) ?? {};
  const identity = readJsonIfExists(path.join(roundDir, "run-identity.json")) ?? {};
  const drift = readJsonIfExists(path.join(roundDir, "config-drift.json")) ?? {};
  const runtime = readJsonIfExists(path.join(roundDir, "runtime-telemetry.json")) ?? {};
  const edge = readJsonIfExists(path.join(roundDir, "edge-analytics.json")) ?? {};
  const report = [
    "# Validation Report",
    "",
    "## STATUS",
    row("runId", runId),
    row("result", summary.result),
    row("exportStatus", summary.exportStatus),
    "",
    "## RUN IDENTITY",
    row("sessionId", identity.sessionId),
    row("mode", identity.mode),
    row("venue", identity.venue),
    row("startedAt", identity.startedAt),
    row("endedAt", identity.endedAt),
    "",
    "## CONFIG HASH",
    row("configHash", identity.configHash),
    row("configDrift", drift.status),
    "",
    "## FUNNEL COUNTERS",
    row("candidateCount", summary.candidateCount),
    row("tradeCount", summary.tradeCount),
    row("failureCount", summary.failureCount),
    "",
    "## WEBSOCKET METRICS",
    row("1008Count", (runtime.marketData as JsonRecord | undefined)?.count1008),
    row("reconnectAttempt", (runtime.marketData as JsonRecord | undefined)?.reconnectAttempt),
    row("reconnectSuccess", (runtime.marketData as JsonRecord | undefined)?.reconnectSuccess),
    "",
    "## BREAKER METRICS",
    row("openBreakers", ((runtime.breaker as JsonRecord | undefined)?.summary as JsonRecord | undefined)?.open),
    row("halfOpenBreakers", ((runtime.breaker as JsonRecord | undefined)?.summary as JsonRecord | undefined)?.halfOpen),
    "",
    "## SHADOW / MOVER",
    row("trackedCandidates", (edge.summary as JsonRecord | undefined)?.candidateCount),
    row("uniqueMoves", (edge.summary as JsonRecord | undefined)?.uniqueMoveCount),
    row("move5Recall", (((edge.summary as JsonRecord | undefined)?.recall as JsonRecord | undefined)?.recall)),
    "",
  ].join("\n");

  const target = outputPath ?? path.join(roundDir, "validation-report.md");
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${report}\n`, "utf8");
  return { runId, found: true, report, outputPath: target };
}
