import type {
  TdiBlockClassification,
  TdiDecisionRecord,
  TdiInputContract,
  TdiInputField,
  TdiInputValueStatus,
} from "@/src/server/forensics/forensic.types";

type TdiInventoryRow = {
  field: string;
  sourceModule: string;
  producer: string;
  consumer: string;
  expectedType: string;
  expectedRange: string;
  required: boolean;
  fallback: string;
  missingDataBehavior: string;
};

type MissingRootCause =
  | "UPSTREAM_NOT_PRODUCED"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_PROVIDER_FAILURE"
  | "NORMALIZATION_FAILURE"
  | "UNIT_CONVERSION_FAILURE"
  | "ROUTING_FAILURE"
  | "ARTIFACT_MAPPING_FAILURE"
  | "PAPER_ONLY_MISSING"
  | "STALE_DATA"
  | "OPTIONAL_NOT_AVAILABLE"
  | "EXPECTED_UNKNOWN"
  | "PARTIAL_PIPELINE_INPUT"
  | "OTHER";

export const TDI_INPUT_INVENTORY: TdiInventoryRow[] = [
  {
    field: "technicalScore",
    sourceModule: "src/server/ai/hybrid-decision-engine.ts",
    producer: "scoreTechnical",
    consumer: "bridgeTdiDecision/buildTdiDecisionRecord",
    expectedType: "number",
    expectedRange: "0..100",
    required: true,
    fallback: "none",
    missingDataBehavior: "DATA_QUALITY_BLOCK",
  },
  {
    field: "momentumScore",
    sourceModule: "src/server/decision-engine/experts/momentum-expert.utils.ts",
    producer: "scoreMomentumImpulse",
    consumer: "bridgeTdiDecision/buildTdiDecisionRecord",
    expectedType: "number",
    expectedRange: "0..100",
    required: true,
    fallback: "none",
    missingDataBehavior: "DATA_QUALITY_BLOCK",
  },
  {
    field: "sentimentScore",
    sourceModule: "src/server/ai/hybrid-decision-engine.ts",
    producer: "scoreSentiment",
    consumer: "bridgeTdiDecision/buildTdiDecisionRecord",
    expectedType: "number",
    expectedRange: "0..100",
    required: true,
    fallback: "none",
    missingDataBehavior: "DATA_QUALITY_BLOCK",
  },
  {
    field: "shortMomentum",
    sourceModule: "src/server/scanner/market-context-builder.ts",
    producer: "market context metadata.shortMomentumPercent",
    consumer: "momentum gates + TDI bridge",
    expectedType: "number",
    expectedRange: "percent-points (e.g. 0.42 = 0.42%)",
    required: true,
    fallback: "none",
    missingDataBehavior: "DATA_QUALITY_BLOCK",
  },
  {
    field: "shortFlowImbalance",
    sourceModule: "src/server/ai/analysis-orchestrator.ts",
    producer: "recent trade flow imbalance",
    consumer: "momentum gates + TDI bridge",
    expectedType: "number",
    expectedRange: "-1..1",
    required: true,
    fallback: "none",
    missingDataBehavior: "DATA_QUALITY_BLOCK",
  },
  {
    field: "executionScore",
    sourceModule: "src/server/execution/execution-orchestrator.service.ts",
    producer: "scanner/quality score",
    consumer: "TDI bridge + forensics",
    expectedType: "number",
    expectedRange: "0..100",
    required: false,
    fallback: "NOT_APPLICABLE",
    missingDataBehavior: "OPTIONAL_NOT_AVAILABLE",
  },
  {
    field: "confidence",
    sourceModule: "src/server/ai/hybrid-decision-engine.ts",
    producer: "hybrid/master consensus confidence",
    consumer: "TDI wait reason + sensitivity",
    expectedType: "number",
    expectedRange: "0..100",
    required: true,
    fallback: "none",
    missingDataBehavior: "DATA_QUALITY_BLOCK",
  },
  {
    field: "bullishCount",
    sourceModule: "src/server/ai/hybrid-decision-engine.ts",
    producer: "directional vote count",
    consumer: "forensic explainability",
    expectedType: "number",
    expectedRange: "0..8",
    required: false,
    fallback: "UNKNOWN",
    missingDataBehavior: "OPTIONAL_NOT_AVAILABLE",
  },
  {
    field: "learningScore",
    sourceModule: "src/server/decision-engine/conflict-detection.service.ts",
    producer: "master matrix learning score",
    consumer: "confidence/momentum attribution",
    expectedType: "number",
    expectedRange: "0..100",
    required: false,
    fallback: "UNKNOWN",
    missingDataBehavior: "OPTIONAL_NOT_AVAILABLE",
  },
  {
    field: "regime",
    sourceModule: "src/server/scanner/market-regime.service.ts",
    producer: "market regime classifier",
    consumer: "hybrid and master deltas",
    expectedType: "string",
    expectedRange: "known regime enum",
    required: true,
    fallback: "UNKNOWN",
    missingDataBehavior: "DATA_QUALITY_BLOCK",
  },
  {
    field: "regimeDelta",
    sourceModule: "src/server/ai/hybrid-decision-engine.ts",
    producer: "resolveRegimePolicy",
    consumer: "threshold reconciliation",
    expectedType: "object",
    expectedRange: "{technical,sentiment,composite}",
    required: true,
    fallback: "none",
    missingDataBehavior: "DATA_QUALITY_BLOCK",
  },
];

function finiteNumberField(value: unknown, source: string, note?: string): TdiInputField<number> {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return { value: null, status: "MISSING", source, note };
  }
  return { value: parsed, status: "AVAILABLE", source, note };
}

function boundedNumberField(
  value: unknown,
  source: string,
  range: { min: number; max: number },
  note?: string,
): TdiInputField<number> {
  const base = finiteNumberField(value, source, note);
  if (base.status !== "AVAILABLE" || base.value == null) return base;
  if (base.value < range.min || base.value > range.max) {
    return { value: base.value, status: "INVALID", source, note: `expected ${range.min}..${range.max}` };
  }
  return base;
}

function textField(value: unknown, source: string): TdiInputField<string> {
  const parsed = String(value ?? "").trim();
  if (!parsed) return { value: null, status: "MISSING", source };
  return { value: parsed, status: "AVAILABLE", source };
}

function inferContextStatus(record: TdiDecisionRecord): TdiInputField<string> {
  const reason = String(record.reasonDetail ?? "");
  if (!reason) return { value: null, status: "MISSING", source: "reasonDetail" };
  if (reason.toLowerCase().includes("stale")) return { value: reason, status: "STALE", source: "reasonDetail" };
  if (reason.toLowerCase().includes("timeout") || reason.toLowerCase().includes("aborted")) {
    return { value: reason, status: "UNKNOWN", source: "reasonDetail", note: "partial-pipeline" };
  }
  return { value: reason, status: "AVAILABLE", source: "reasonDetail" };
}

function inferScoreType(record: TdiDecisionRecord) {
  return record.scoreType ?? (record.candidateId.startsWith("hybrid:") ? "HYBRID_COMPOSITE" : record.candidateId.startsWith("tdi:") ? "MASTER_EXPERT_AVERAGE" : "UNKNOWN");
}

export function buildTdiInputContract(record: TdiDecisionRecord): TdiInputContract {
  const scoreType = inferScoreType(record);
  const expectedValue = scoreType === "HYBRID_COMPOSITE" ? record.hybridCompositeScore : record.masterExpertConsensusScore;
  return {
    technicalScore: finiteNumberField(record.technicalScore, "hybrid/master bridge"),
    momentumScore: finiteNumberField(record.momentumScore, "hybrid/master bridge"),
    sentimentScore: finiteNumberField(record.sentimentScore, "hybrid/master bridge"),
    shortMomentum: boundedNumberField(
      record.shortMomentum,
      "market context metadata.shortMomentumPercent",
      { min: -25, max: 25 },
      "percent-points",
    ),
    shortFlowImbalance: boundedNumberField(
      record.shortFlow,
      "market context metadata.shortFlowImbalance",
      { min: -1, max: 1 },
      "normalized flow imbalance",
    ),
    executionScore: record.executionScore == null
      ? { value: null, status: "NOT_APPLICABLE", source: "execution stage", note: "not required in every WAIT path" }
      : finiteNumberField(record.executionScore, "scanner/execution quality score"),
    confidence: finiteNumberField(record.confidence, "hybrid/master confidence"),
    bullishCount: record.bullishCount == null
      ? { value: null, status: "UNKNOWN", source: "directional votes" }
      : finiteNumberField(record.bullishCount, "directional votes"),
    learningScore: record.learningScore == null
      ? { value: null, status: "NOT_APPLICABLE", source: "master matrix.learning" }
      : finiteNumberField(record.learningScore, "master matrix.learning"),
    regime: textField(record.regime, "market regime"),
    regimeDelta: record.regimeDelta
      ? { value: record.regimeDelta, status: "AVAILABLE", source: "resolveRegimePolicy" }
      : { value: null, status: "MISSING", source: "resolveRegimePolicy" },
    thresholds: record.thresholds
      ? { value: record.thresholds, status: "AVAILABLE", source: "strategyRuntime thresholds" }
      : { value: null, status: "MISSING", source: "strategyRuntime thresholds" },
    liquidity: finiteNumberField(record.liquidity, "market context"),
    volatility: finiteNumberField(record.volatility, "market context"),
    expectedValue: finiteNumberField(expectedValue, "consensus score by scoreType"),
    openInterest: finiteNumberField(record.openInterest, "futures intelligence"),
    marketContext:
      String(record.reasonDetail ?? "").toLowerCase().includes("stale")
        ? { value: record.marketContext ?? String(record.reasonDetail ?? ""), status: "STALE", source: "market context" }
        : record.marketContext
          ? textField(record.marketContext, "market context")
          : inferContextStatus(record),
    simulation: {
      value: record.simulation ?? (record.paperRelaxed === true ? "PAPER" : "LIVE_OR_OTHER"),
      status: "AVAILABLE",
      source: "execution mode",
    },
    trendData: record.trendData ? textField(record.trendData, "market regime trend") : textField(record.regime, "market regime trend"),
  };
}

function classifyMissingRootCause(
  record: TdiDecisionRecord,
  field: keyof TdiInputContract,
  status: TdiInputValueStatus,
): MissingRootCause {
  if (status === "INVALID") return "UNIT_CONVERSION_FAILURE";
  const reason = String(record.reasonDetail ?? "").toLowerCase();
  if (reason.includes("timeout") || reason.includes("aborted")) return "UPSTREAM_TIMEOUT";
  if (reason.includes("stale")) return "STALE_DATA";
  if (record.paperRelaxed && (field === "openInterest" || field === "liquidity")) return "PAPER_ONLY_MISSING";
  if (record.candidateId.startsWith("execution:") && ["technicalScore", "momentumScore", "sentimentScore"].includes(field)) {
    return "ROUTING_FAILURE";
  }
  if (field === "shortMomentum" || field === "shortFlowImbalance") return "UPSTREAM_NOT_PRODUCED";
  if (field === "executionScore" || field === "learningScore" || field === "openInterest") return "OPTIONAL_NOT_AVAILABLE";
  return "OTHER";
}

function isFieldRequiredForBlock(record: TdiDecisionRecord, field: keyof TdiInputContract) {
  const blockers = record.blockingConditions ?? [];
  if (field === "technicalScore" || field === "thresholds" || field === "regimeDelta") {
    return blockers.includes("TECHNICAL") || record.firstBlockingCondition === "TECHNICAL";
  }
  if (field === "momentumScore" || field === "shortMomentum" || field === "shortFlowImbalance") {
    return blockers.includes("MOMENTUM") || record.firstBlockingCondition === "MOMENTUM";
  }
  if (field === "confidence") {
    return blockers.includes("CONFIDENCE") || record.firstBlockingCondition === "CONFIDENCE" || record.verdict === "WAIT";
  }
  if (field === "sentimentScore") return record.verdict === "WAIT";
  if (field === "regime" || field === "marketContext") return true;
  return false;
}

export function inferDataQualityIssues(record: TdiDecisionRecord, contract: TdiInputContract) {
  const missingFields: string[] = [];
  const rootCauseByField: Record<string, MissingRootCause> = {};
  for (const [field, data] of Object.entries(contract) as Array<[keyof TdiInputContract, TdiInputField]>) {
    if (data.status === "MISSING" || data.status === "INVALID" || data.status === "STALE") {
      if (isFieldRequiredForBlock(record, field)) {
        missingFields.push(String(field));
      }
      rootCauseByField[String(field)] = classifyMissingRootCause(record, field, data.status);
    }
  }
  return {
    missingFields,
    rootCauseByField,
    dataQualityIssues: missingFields.map((field) => `MISSING_${field.toUpperCase()}:${rootCauseByField[field] ?? "OTHER"}`),
  };
}

export function classifyTdiBlock(record: TdiDecisionRecord): TdiBlockClassification {
  const hasDataQuality = Array.isArray(record.dataQualityIssues) && record.dataQualityIssues.length > 0;
  return hasDataQuality ? "DATA_QUALITY_BLOCK" : "POLICY_BLOCK";
}

export function buildTdiDataQualityArtifacts(records: TdiDecisionRecord[]) {
  const rows = records.map((row) => {
    const contract = row.tdiInputContract ?? buildTdiInputContract(row);
    const inferred = inferDataQualityIssues(row, contract);
    return {
      ...row,
      tdiInputContract: contract,
      missingFields: inferred.missingFields,
      dataQualityIssues: inferred.dataQualityIssues,
      blockClassification:
        inferred.dataQualityIssues.length > 0 ? ("DATA_QUALITY_BLOCK" as const) : ("POLICY_BLOCK" as const),
      rootCauseByField: inferred.rootCauseByField,
    };
  });
  const waitRows = rows.filter((row) => row.verdict === "WAIT");
  const missingRows = waitRows.filter((row) => (row.missingFields?.length ?? 0) > 0);
  const missingByField: Record<string, number> = {};
  const rootCauseCounts: Record<string, number> = {};
  for (const row of missingRows) {
    for (const field of row.missingFields ?? []) {
      missingByField[field] = (missingByField[field] ?? 0) + 1;
      const cause = row.rootCauseByField?.[field] ?? "OTHER";
      rootCauseCounts[cause] = (rootCauseCounts[cause] ?? 0) + 1;
    }
  }
  const dataQualityBlockCount = waitRows.filter((row) => row.blockClassification === "DATA_QUALITY_BLOCK").length;
  const policyBlockCount = waitRows.filter((row) => row.blockClassification === "POLICY_BLOCK").length;
  return {
    inventory: TDI_INPUT_INVENTORY,
    inputContracts: rows.map((row) => ({
      candidateId: row.candidateId,
      symbol: row.symbol,
      verdict: row.verdict,
      firstBlockingCondition: row.firstBlockingCondition,
      blockingConditions: row.blockingConditions ?? [],
      blockClassification: row.blockClassification,
      tdiInputContract: row.tdiInputContract,
      missingFields: row.missingFields ?? [],
      dataQualityIssues: row.dataQualityIssues ?? [],
    })),
    missingTelemetryReport: {
      totalWaitRecords: waitRows.length,
      missingTelemetryCount: missingRows.length,
      missingByField,
      rootCauseCounts,
      rows: missingRows.map((row) => ({
        candidateId: row.candidateId,
        symbol: row.symbol,
        strategy: row.strategy ?? "UNKNOWN",
        timestamp: row.timestamp,
        firstBlockingCondition: row.firstBlockingCondition ?? "OTHER",
        blockingConditions: row.blockingConditions ?? [],
        missingFields: row.missingFields ?? [],
        dataQualityIssues: row.dataQualityIssues ?? [],
        rootCauseByField: row.rootCauseByField,
      })),
    },
    dataQualitySummary: {
      waitCount: waitRows.length,
      dataQualityBlockCount,
      policyBlockCount,
    },
  };
}

