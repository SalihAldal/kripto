import fs from "node:fs";
import path from "node:path";
import { evaluateAiExecutionReadiness } from "@/src/server/execution/ai-execution-gate.service";

type TdiRow = {
  candidateId: string;
  symbol: string;
  hybridDecision?: string;
  masterDecision?: string;
  legacyDecision?: string;
  confidence?: number;
};

const REFERENCE_SESSION = "cmstltuqn0007un9ksbk3xn9c";
const BLOCKING = new Set(["NO_TRADE", "NO-TRADE", "HOLD", "WAIT", "REJECT"]);
const TARGET_CASE_COUNT = 45;

function normalizeDecision(input: string | null | undefined) {
  const raw = String(input ?? "").trim().toUpperCase();
  if (raw === "NO-TRADE" || raw === "NO TRADE") return "NO_TRADE";
  return raw;
}

function loadCanonicalRows(): TdiRow[] {
  const root = path.join(process.cwd(), "artifacts", "forensics", REFERENCE_SESSION, "rounds");
  if (!fs.existsSync(root)) return [];
  const rows: TdiRow[] = [];
  for (const roundDir of fs.readdirSync(root).filter((name) => /^\d+$/.test(name))) {
    const file = path.join(root, roundDir, "tdi-decisions.json");
    if (!fs.existsSync(file)) continue;
    const payload = JSON.parse(fs.readFileSync(file, "utf8")) as { records?: TdiRow[] };
    rows.push(...(payload.records ?? []));
  }
  return rows;
}

function deriveAiDecision(row: TdiRow) {
  const hybrid = normalizeDecision(row.hybridDecision);
  const master = normalizeDecision(row.masterDecision);
  const legacy = normalizeDecision(row.legacyDecision);
  if (BLOCKING.has(hybrid)) return hybrid;
  if (BLOCKING.has(master)) return master;
  if (BLOCKING.has(legacy)) return legacy;
  return "";
}

function buildReplayCases() {
  const rows = loadCanonicalRows();
  const selected: Array<{
    candidateId: string;
    roundId: string;
    symbol: string;
    aiDecision: string;
    consensusDecision: string;
    confidence: number;
  }> = [];

  for (const row of rows) {
    const aiDecision = deriveAiDecision(row);
    if (!BLOCKING.has(aiDecision)) continue;
    const roundId = row.candidateId.split(":")[2] ?? "n/a";
    selected.push({
      candidateId: row.candidateId,
      roundId,
      symbol: row.symbol,
      aiDecision,
      consensusDecision: aiDecision,
      confidence: Number(row.confidence ?? 25),
    });
    if (selected.length >= TARGET_CASE_COUNT) break;
  }
  return selected;
}

function main() {
  const replayCases = buildReplayCases();
  const rows = replayCases.map((row) => {
    const gate = evaluateAiExecutionReadiness({
      ai: {
        finalDecision: row.aiDecision,
        finalConsensusDecision: row.consensusDecision as "BUY" | "SELL" | "NO-TRADE" | "REJECT" | "WATCHLIST",
        outputs: [{ providerId: "replay", ok: true, output: { decision: row.aiDecision as "BUY" | "SELL" | "HOLD" | "NO_TRADE", confidence: row.confidence } }],
      } as never,
      policy: "VETO",
      learningLane: false,
      microTradeEligible: false,
    });
    const executionVerdict = gate.verdict === "AI_GATE_PASS" ? "EXECUTE" : "BLOCK";
    return {
      candidateId: row.candidateId,
      roundId: row.roundId,
      symbol: row.symbol,
      aiDecision: row.aiDecision,
      consensusDecision: row.consensusDecision,
      decisionLayer: "AI_EXECUTION_GATE",
      aiGateVerdict: gate.verdict,
      executionVerdict,
      simulatedTrade: executionVerdict === "EXECUTE",
      reasonCode: gate.reasonCode,
      reasonDetail: gate.reasonDetail,
    };
  });

  const blocked = rows.filter((row) => row.executionVerdict === "BLOCK").length;
  const executed = rows.filter((row) => row.executionVerdict === "EXECUTE").length;
  const byReason: Record<string, number> = {};
  for (const row of rows) {
    byReason[row.reasonCode] = (byReason[row.reasonCode] ?? 0) + 1;
  }

  const result = {
    generatedAt: new Date().toISOString(),
    source: `artifacts/forensics/${REFERENCE_SESSION}/rounds/*/tdi-decisions.json`,
    referenceEvidence: {
      backlogId: "KRIPTO-EXEC-001",
      historicalNoTradeExecutedBefore: 45,
      note: "Before-count is taken from forensic evidence provided in P0 scope.",
    },
    replaySummary: {
      replayedCases: rows.length,
      blocked,
      executed,
      historicalNoTradeExecutedAfter: executed,
      vetoParity: executed === 0 ? "PASS" : "FAIL",
      reasonFrequency: byReason,
    },
    cases: rows,
  };

  const outPath = path.join(process.cwd(), "reports", "p0-execution-parity-replay.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result.replaySummary, null, 2));
  console.log(`Wrote ${outPath}`);
}

main();
