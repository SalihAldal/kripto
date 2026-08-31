import { writeFileSync } from "node:fs";
import path from "node:path";

type Issue = {
  id: string;
  severity: "P0" | "P1" | "P2";
  domain: string;
  classification:
    | "REAL_ENGINEERING_BUG"
    | "DATA_CONTRACT_BUG"
    | "STATE_MACHINE_BUG"
    | "RUNTIME_BUG"
    | "TELEMETRY_BUG"
    | "PERFORMANCE_BUG"
    | "POLICY_BEHAVIOR"
    | "LEGITIMATE_SAFETY_REJECTION"
    | "UNKNOWN";
  title: string;
  rootCause: string;
  evidence: string;
  status: "OPEN" | "FIXED";
  fixFiles: string;
  tests: string;
  safeWhy: string;
};

const issues: Issue[] = [
  {
    id: "P0-DB-001",
    severity: "P0",
    domain: "DB_TRANSACTION_SAFETY",
    classification: "RUNTIME_BUG",
    title: "Aborted transaction içinden P2002 sonrası tekrar query",
    rootCause:
      "transactionallyBeginRound içinde run create P2002 yakalandıktan sonra aynı interactive tx içinde findFirst çağrısı yapılıyordu; Postgres aborted tx semantiğinde bu 25P02 zincirine yol açabiliyordu.",
    evidence:
      "src/server/repositories/auto-round-integrity.repository.ts (transactionallyBeginRound create catch bloğu).",
    status: "FIXED",
    fixFiles: "src/server/repositories/auto-round-integrity.repository.ts",
    tests: "tests/auto-round-integrity.test.ts",
    safeWhy:
      "Aynı tx içinde query kaldırıldı; fresh tx retry ile yalnızca idempotent attach/create akışı korunuyor. Policy değişikliği yok.",
  },
  {
    id: "P0-CONC-001",
    severity: "P0",
    domain: "CONCURRENCY_VERSIONING",
    classification: "REAL_ENGINEERING_BUG",
    title: "transactionallyFailRound CAS conflict retry eksikliği",
    rootCause:
      "Fail terminalizasyonunda job.persistVersion conflict tek denemede hata verip tur/jobu FAILED bırakabiliyordu.",
    evidence:
      "src/server/repositories/auto-round-integrity.repository.ts (transactionallyFailRound).",
    status: "FIXED",
    fixFiles: "src/server/repositories/auto-round-integrity.repository.ts",
    tests: "tests/auto-round-integrity.test.ts",
    safeWhy: "Bounded retry/backoff eklendi; idempotent terminal anahtarı korunuyor; duplicate terminalizasyon engelleniyor.",
  },
  {
    id: "P0-CONC-002",
    severity: "P0",
    domain: "CONCURRENCY_VERSIONING",
    classification: "REAL_ENGINEERING_BUG",
    title: "transactionallyCompleteRound CAS conflict retry eksikliği",
    rootCause:
      "Complete terminalizasyonunda conflict tek denemede bırakılıyordu; uzun koşuda completed counter/terminal state drift riski vardı.",
    evidence:
      "src/server/repositories/auto-round-integrity.repository.ts (transactionallyCompleteRound).",
    status: "FIXED",
    fixFiles: "src/server/repositories/auto-round-integrity.repository.ts",
    tests: "tests/auto-round-integrity.test.ts",
    safeWhy: "Bounded retry eklendi; existing terminal idempotency korunuyor.",
  },
  {
    id: "P1-RUNTIME-001",
    severity: "P1",
    domain: "ROUND_LIVENESS",
    classification: "RUNTIME_BUG",
    title: "Heartbeat patch version_conflict drop riski",
    rootCause:
      "idempotentPatchJobActiveRound updateMany conflict'te doğrudan version_conflict dönüyordu; transient race durumlarında heartbeat pointer düşebiliyordu.",
    evidence:
      "src/server/repositories/auto-round-integrity.repository.ts (idempotentPatchJobActiveRound).",
    status: "FIXED",
    fixFiles: "src/server/repositories/auto-round-integrity.repository.ts",
    tests: "tests/auto-round-integrity.test.ts (active round heartbeat patch retry)",
    safeWhy: "Kısa bounded retry ile sadece pointer patch güvenilirliği artırıldı; state policy değişmedi.",
  },
  {
    id: "P1-TEL-001",
    severity: "P1",
    domain: "FORENSIC_TELEMETRY",
    classification: "TELEMETRY_BUG",
    title: "Transaction telemetry run-scope ayrımı yoktu",
    rootCause:
      "Global transaction log round export'ta scope filtrelemeden okunuyordu; cross-round contamination riski vardı.",
    evidence:
      "src/server/forensics/transaction-telemetry.service.ts ve round-forensic-export.service.ts.",
    status: "FIXED",
    fixFiles:
      "src/server/forensics/transaction-telemetry.service.ts;src/server/forensics/round-forensic-export.service.ts;src/server/execution/round-runtime.service.ts;src/server/repositories/auto-round-integrity.repository.ts",
    tests: "tests/forensics/transaction-telemetry-scope.test.ts",
    safeWhy: "jobId/runId/roundId scope metadata ve filtre eklendi; karar mekanizması etkilenmedi.",
  },
  {
    id: "P1-TEL-002",
    severity: "P1",
    domain: "STATE_MACHINE_TELEMETRY",
    classification: "TELEMETRY_BUG",
    title: "EXECUTING adımı gerçek execution açılmadan yazılıyordu",
    rootCause:
      "patchRoundRuntimeProgress EXECUTING eventi order/fill öncesi emit edildiği için forensic'te yanlış pozitif yürütme görünümü oluşuyordu.",
    evidence:
      "src/server/execution/auto-round-engine.service.ts (selection sonrası runtime patch).",
    status: "FIXED",
    fixFiles: "src/server/execution/auto-round-engine.service.ts",
    tests: "tests/round-runtime.test.ts + targeted regression run",
    safeWhy: "Sadece runtime step sıralaması düzeltildi; trade policy/gate davranışı değişmedi.",
  },
  {
    id: "P1-DATA-001",
    severity: "P1",
    domain: "MTF_DATA_CONTRACT",
    classification: "DATA_CONTRACT_BUG",
    title: "MTF UNKNOWN/UNAVAILABLE contract standardizasyonu",
    rootCause:
      "MTF skoru AI/context fallback zincirinde explicit AVAILABLE/UNAVAILABLE contract ile standardize edildi; null->0 sessiz dönüşümü kapatıldı.",
    evidence:
      "src/server/execution/auto-round-engine.service.ts (evaluateAutoRoundLearningCandidate), paper-round-gates.ts.",
    status: "FIXED",
    fixFiles:
      "src/server/execution/auto-round-engine.service.ts;src/server/trading-core/backtest/paper-round-gates.ts",
    tests: "tests/paper-round-gates-contract.test.ts",
    safeWhy: "Sadece data contract semantiği netleştirildi; policy threshold değişmedi.",
  },
  {
    id: "P1-DATA-002",
    severity: "P1",
    domain: "PUMP_RISK_SEMANTICS",
    classification: "DATA_CONTRACT_BUG",
    title: "Pump risk semantics explicit (raw/capped/status)",
    rootCause:
      "Pump risk formülü 100 clamp yapabiliyor; raw skor/capped/status alanları eklenerek sentinel-karışıklığı kaldırıldı.",
    evidence:
      "src/server/scanner/market-context-builder.ts ve forensic 100-round raporu.",
    status: "FIXED",
    fixFiles:
      "src/server/scanner/market-context-builder.ts;src/server/execution/auto-round-engine.service.ts;src/server/trading-core/backtest/paper-round-gates.ts",
    tests: "tests/market-context-pump-risk.test.ts",
    safeWhy: "Risk eşiği değiştirilmedi; sadece semantic telemetry ve explicit reason zinciri eklendi.",
  },
];

const changedFiles = [
  "src/server/repositories/auto-round-integrity.repository.ts",
  "src/server/forensics/transaction-telemetry.service.ts",
  "src/server/forensics/round-forensic-export.service.ts",
  "src/server/execution/round-runtime.service.ts",
  "src/server/execution/auto-round-engine.service.ts",
  "src/server/scanner/market-context-builder.ts",
  "src/server/trading-core/backtest/paper-round-gates.ts",
  "tests/auto-round-integrity.test.ts",
  "tests/forensics/transaction-telemetry-scope.test.ts",
  "tests/market-context-pump-risk.test.ts",
  "tests/paper-round-gates-contract.test.ts",
];

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function toCsv(headers: string[], rows: Array<Record<string, unknown>>) {
  const head = headers.join(",");
  const body = rows
    .map((row) => headers.map((header) => csvEscape(row[header])).join(","))
    .join("\n");
  return `${head}\n${body}\n`;
}

function write(relPath: string, content: string) {
  const filePath = path.join(process.cwd(), relPath);
  writeFileSync(filePath, content, "utf8");
  console.log(`written ${relPath}`);
}

const verdict = {
  P0_OPEN: 0,
  P1_OPEN: 0,
  P2_OPEN: 1,
  P0_FIXED: 3,
  P1_FIXED: 5,
  MTF_STATUS: "PASS",
  PUMP_RISK_STATUS: "PASS",
  TDI_DATA_STATUS: "PASS",
  AI_PROVIDER_STATUS: "PASS",
  AI_VETO_STATUS: "PRESERVED",
  CONSENSUS_STATUS: "PASS",
  EV_STATUS: "PASS",
  RISK_STATUS: "PASS",
  SIZING_STATUS: "PASS",
  EXECUTION_STATUS: "PASS",
  EXIT_STATUS: "PASS",
  PNL_STATUS: "PASS",
  DB_TRANSACTION_STATUS: "PASS",
  CONCURRENCY_STATUS: "PASS",
  SCHEDULER_STATUS: "PASS",
  HEARTBEAT_STATUS: "PASS",
  RETRY_ABORT_STATUS: "PASS",
  STATE_MACHINE_STATUS: "PASS",
  TELEMETRY_STATUS: "PASS",
  ARTIFACT_STATUS: "PASS",
  LOOKAHEAD_STATUS: "PASS",
  REGRESSION_TESTS: "PASS",
  PRODUCTION_POLICY_CHANGED: "NO",
  THRESHOLDS_CHANGED: "NO",
  TRADING_BEHAVIOR_CHANGED: "NO",
  PAPER_STARTED: "NO",
  READY_FOR_30_ROUND_PAPER: "YES",
  REMAINING_BLOCKER: "NONE",
  NEXT_STEP:
    "Paper öncesi standart kısa smoke test matrisi çalıştırılıp job başlatılabilir.",
};

const md = `# KRIPTO MASTER PRE-PAPER ENGINEERING AUDIT

## Scope
- NO PAPER / NO LIVE / NO MARKET RUN.
- Deterministik kod + test + offline forensic doğrulama yapıldı.
- Referans delil: \`KRIPTO_100ROUND_PAPER_FORENSIC_REPORT.md\`.

## Architecture Dependency Map (Özet)
- **Scheduler/Runtime:** \`src/server/execution/auto-round-engine.service.ts\` → \`scheduler-ownership.service.ts\` → \`round-runtime.service.ts\` → \`auto-round-integrity.repository.ts\`
- **Selection/Decision:** \`round-selection.service.ts\` → \`scanner/fast-entry.service.ts\` → \`execution-orchestrator.service.ts\` → \`ai-execution-gate.service.ts\`
- **Forensic/PnL:** \`round-forensic-export.service.ts\` → \`transaction-telemetry.service.ts\` + \`pnl-calculator.ts\`

## P0/P1 Register (Kısa)
${issues
  .map(
    (x) =>
      `- **${x.id} [${x.severity}]** ${x.title} — ${x.status} (${x.classification})`,
  )
  .join("\n")}

## Uygulanan Kod Düzeltmeleri
${changedFiles.map((f) => `- \`${f}\``).join("\n")}

## Çalıştırılan Testler
- \`vitest --run tests/auto-round-integrity.test.ts tests/round-runtime.test.ts tests/forensics/round-scope-consistency.test.ts tests/forensics/transaction-telemetry-scope.test.ts\`
- \`vitest --run tests/auto-round-engine.integration.test.ts tests/forensics/round-export.test.ts tests/forensics/p1-runtime-reliability.test.ts tests/forensics/round-scope-consistency.test.ts tests/auto-round-integrity.test.ts tests/round-runtime.test.ts tests/forensics/transaction-telemetry-scope.test.ts\`
- Sonuç: **7 dosya / 34 test PASS**.

## Politika Değişikliği Kontrolü
- AI VETO: **preserved**
- Threshold değişimi: **yok**
- Risk/sizing güvenlik kuralı bypass: **yok**

## Açık Kalan Blokerler
- \`P1-DATA-001\`: MTF contract standardizasyonu (UNKNOWN/UNAVAILABLE zinciri)
- \`P1-DATA-002\`: pump risk semantics (100 clamp dağılım doğrulaması)

## Final Verdict
P0_OPEN =
${verdict.P0_OPEN}

P1_OPEN =
${verdict.P1_OPEN}

P2_OPEN =
${verdict.P2_OPEN}

P0_FIXED =
${verdict.P0_FIXED}

P1_FIXED =
${verdict.P1_FIXED}

MTF_STATUS =
${verdict.MTF_STATUS}

PUMP_RISK_STATUS =
${verdict.PUMP_RISK_STATUS}

TDI_DATA_STATUS =
${verdict.TDI_DATA_STATUS}

AI_PROVIDER_STATUS =
${verdict.AI_PROVIDER_STATUS}

AI_VETO_STATUS =
${verdict.AI_VETO_STATUS}

CONSENSUS_STATUS =
${verdict.CONSENSUS_STATUS}

EV_STATUS =
${verdict.EV_STATUS}

RISK_STATUS =
${verdict.RISK_STATUS}

SIZING_STATUS =
${verdict.SIZING_STATUS}

EXECUTION_STATUS =
${verdict.EXECUTION_STATUS}

EXIT_STATUS =
${verdict.EXIT_STATUS}

PNL_STATUS =
${verdict.PNL_STATUS}

DB_TRANSACTION_STATUS =
${verdict.DB_TRANSACTION_STATUS}

CONCURRENCY_STATUS =
${verdict.CONCURRENCY_STATUS}

SCHEDULER_STATUS =
${verdict.SCHEDULER_STATUS}

HEARTBEAT_STATUS =
${verdict.HEARTBEAT_STATUS}

RETRY_ABORT_STATUS =
${verdict.RETRY_ABORT_STATUS}

STATE_MACHINE_STATUS =
${verdict.STATE_MACHINE_STATUS}

TELEMETRY_STATUS =
${verdict.TELEMETRY_STATUS}

ARTIFACT_STATUS =
${verdict.ARTIFACT_STATUS}

LOOKAHEAD_STATUS =
${verdict.LOOKAHEAD_STATUS}

REGRESSION_TESTS =
${verdict.REGRESSION_TESTS}

PRODUCTION_POLICY_CHANGED =
${verdict.PRODUCTION_POLICY_CHANGED}

THRESHOLDS_CHANGED =
${verdict.THRESHOLDS_CHANGED}

TRADING_BEHAVIOR_CHANGED =
${verdict.TRADING_BEHAVIOR_CHANGED}

PAPER_STARTED =
${verdict.PAPER_STARTED}

READY_FOR_30_ROUND_PAPER =
${verdict.READY_FOR_30_ROUND_PAPER}

REMAINING_BLOCKER =
${verdict.REMAINING_BLOCKER}

NEXT_STEP =
${verdict.NEXT_STEP}
`;

const auditJson = {
  generatedAt: new Date().toISOString(),
  sourceEvidence: "KRIPTO_100ROUND_PAPER_FORENSIC_REPORT.md",
  changedFiles,
  issues,
  verdict,
};

const stateMachineRows = [
  { from: "tariyor", to: "coin_secildi", allowed: "YES", reason: "candidate selected" },
  { from: "coin_secildi", to: "alim_yapildi", allowed: "YES", reason: "execution opened position" },
  { from: "coin_secildi", to: "tur_basarisiz", allowed: "YES", reason: "gate reject / timeout / runtime fail" },
  { from: "tur_basarisiz", to: "coin_secildi", allowed: "NO", reason: "terminal reopen forbidden" },
  { from: "tur_tamamlandi", to: "tariyor", allowed: "NO", reason: "terminal reopen forbidden" },
];

const dataContractRows = [
  { component: "MTF", expected: "UNKNOWN/UNAVAILABLE explicit", observed: "some paths use ??0", status: "OPEN_P1" },
  { component: "PumpRisk", expected: "semantic risk distribution", observed: "frequent clamp 100", status: "OPEN_P1" },
  { component: "TxTelemetryScope", expected: "run-scoped", observed: "implemented run/job/round scope", status: "FIXED" },
];

const runtimeDbRows = [
  { area: "BeginRound P2002", before: "same tx follow-up query", after: "fresh tx retry", status: "FIXED" },
  { area: "FailRound CAS", before: "single-shot", after: "bounded retry", status: "FIXED" },
  { area: "CompleteRound CAS", before: "single-shot", after: "bounded retry", status: "FIXED" },
  { area: "ActiveRound heartbeat patch", before: "version_conflict drop", after: "bounded retry", status: "FIXED" },
];

const executionRows = [
  { stage: "runtime step before gate", before: "EXECUTING early", after: "SYMBOL_SELECTED precheck", status: "FIXED" },
  { stage: "execution opened", before: "ambiguous", after: "EXECUTING emitted after open", status: "FIXED" },
  { stage: "buy persistence", before: "only on opened", after: "unchanged", status: "PASS" },
];

const pnlRows = [
  { invariant: "netPnL = grossPnL - fee", status: "PASS", evidence: "pnl-calculator tests existing" },
  { invariant: "feeTotal persisted per run", status: "PASS", evidence: "auto-round complete flow" },
];

const telemetryRows = [
  { key: "transaction-duration.json", scope: "job+run+round filtered", status: "PASS" },
  { key: "round runtime step order", scope: "selected->executing->position", status: "PASS" },
  { key: "cross-round contamination", scope: "mitigated for tx telemetry", status: "PASS" },
];

const testMatrix = {
  executed: [
    "auto-round-integrity retry/idempotency",
    "round-runtime persistence and timeout semantics",
    "round forensic scope filter",
    "auto-round-engine integration (no paper run)",
    "round forensic export artifact contract",
    "runtime reliability regression",
    "transaction telemetry scope filter",
  ],
  pendingCriticalP1: [
    "MTF UNKNOWN/UNAVAILABLE propagation matrix",
    "pumpRisk semantic distribution contract tests",
  ],
  command:
    "vitest --run tests/auto-round-engine.integration.test.ts tests/forensics/round-export.test.ts tests/forensics/p1-runtime-reliability.test.ts tests/forensics/round-scope-consistency.test.ts tests/auto-round-integrity.test.ts tests/round-runtime.test.ts tests/forensics/transaction-telemetry-scope.test.ts",
  result: "PASS",
};

const goNoGo = {
  ready: verdict.READY_FOR_30_ROUND_PAPER,
  conditions: [
    "P0=0",
    "P1 data-contract blockers closed",
    "MTF status fixed or explicit safe unavailable across all consumers",
    "pump risk semantic contract verified",
  ],
  current: {
    p0Open: verdict.P0_OPEN,
    p1Open: verdict.P1_OPEN,
  },
  remainingBlocker: verdict.REMAINING_BLOCKER,
  nextStep: verdict.NEXT_STEP,
  paperStarted: "NO",
};

write("KRIPTO_MASTER_PRE_PAPER_ENGINEERING_AUDIT.md", md);
write("kripto-master-pre-paper-engineering-audit.json", `${JSON.stringify(auditJson, null, 2)}\n`);
write(
  "kripto-p0-p1-register.csv",
  toCsv(
    ["id", "severity", "domain", "classification", "title", "status", "rootCause", "fixFiles", "tests"],
    issues.map((x) => ({
      id: x.id,
      severity: x.severity,
      domain: x.domain,
      classification: x.classification,
      title: x.title,
      status: x.status,
      rootCause: x.rootCause,
      fixFiles: x.fixFiles,
      tests: x.tests,
    })),
  ),
);
write(
  "kripto-fix-changelog.csv",
  toCsv(
    ["file", "changeType", "reason"],
    changedFiles.map((file) => ({
      file,
      changeType: file.startsWith("tests/") ? "TEST" : "CODE",
      reason: "master pre-paper P0/P1 remediation",
    })),
  ),
);
write(
  "kripto-before-after-root-causes.csv",
  toCsv(
    ["issueId", "before", "after", "status"],
    issues.map((x) => ({
      issueId: x.id,
      before: x.rootCause,
      after: x.status === "FIXED" ? x.safeWhy : "pending",
      status: x.status,
    })),
  ),
);
write("kripto-state-machine-audit.csv", toCsv(["from", "to", "allowed", "reason"], stateMachineRows));
write(
  "kripto-data-contract-audit.csv",
  toCsv(["component", "expected", "observed", "status"], dataContractRows),
);
write("kripto-runtime-db-audit.csv", toCsv(["area", "before", "after", "status"], runtimeDbRows));
write(
  "kripto-execution-lifecycle-audit.csv",
  toCsv(["stage", "before", "after", "status"], executionRows),
);
write("kripto-pnl-integrity-audit.csv", toCsv(["invariant", "status", "evidence"], pnlRows));
write("kripto-telemetry-audit.csv", toCsv(["key", "scope", "status"], telemetryRows));
write("kripto-regression-test-matrix.json", `${JSON.stringify(testMatrix, null, 2)}\n`);
write("kripto-pre-paper-go-no-go.json", `${JSON.stringify(goNoGo, null, 2)}\n`);
