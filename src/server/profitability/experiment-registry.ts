export type ProfitabilityExperimentStatus =
  | "PLANNED"
  | "RUNNING"
  | "COMPLETED"
  | "BLOCKED"
  | "NOT_RUN";

export type ProfitabilityExperimentRecord = {
  experimentId: string;
  hypothesis: string;
  strategyPolicyVersion: string | null;
  featureSchemaVersion: string | null;
  datasetSchemaVersion: string | null;
  period: { from: string | null; to: string | null };
  venue: string | null;
  universe: string | null;
  costAssumptions: string[];
  latencyAssumptions: string[];
  splitManifest: string | null;
  variantCount: number;
  trainUsed: boolean;
  validationUsed: boolean;
  testUsed: boolean;
  status: ProfitabilityExperimentStatus;
  evidenceRefs: string[];
  createdAt: string;
  updatedAt: string;
};

const registry = new Map<string, ProfitabilityExperimentRecord>();

export function registerProfitabilityExperiment(
  input: Omit<ProfitabilityExperimentRecord, "createdAt" | "updatedAt">,
): ProfitabilityExperimentRecord {
  const now = new Date().toISOString();
  const existing = registry.get(input.experimentId);
  const record: ProfitabilityExperimentRecord = {
    ...input,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  registry.set(input.experimentId, record);
  return record;
}

export function getProfitabilityExperiment(experimentId: string) {
  return registry.get(experimentId) ?? null;
}

export function listProfitabilityExperiments() {
  return Array.from(registry.values()).sort((a, b) => a.experimentId.localeCompare(b.experimentId));
}

export function resetProfitabilityExperimentRegistryForTests() {
  registry.clear();
}

export function ensurePr01BaselineExperiment() {
  return registerProfitabilityExperiment({
    experimentId: "pr01-opportunity-universe-v1",
    hypothesis:
      "Measure tradeable opportunity universe, detection latency, and net economics without strategy promotion.",
    strategyPolicyVersion: null,
    featureSchemaVersion: "er02-feature-contract-v1",
    datasetSchemaVersion: "er05-dataset-v1",
    period: { from: null, to: null },
    venue: "BINANCE_TR",
    universe: "point-in-time-symbol-set",
    costAssumptions: ["configured-taker-fee", "modeled-exit-cost-optional"],
    latencyAssumptions: ["structured-event-timestamps-only"],
    splitManifest: null,
    variantCount: 0,
    trainUsed: false,
    validationUsed: false,
    testUsed: false,
    status: "PLANNED",
    evidenceRefs: [],
  });
}

export function ensurePr02EarlyExperiment() {
  return registerProfitabilityExperiment({
    experimentId: "pr02-early-acceleration-v1",
    hypothesis:
      "Early acceleration setups form when measurable price move, trade/flow confirmation, and fresh execution-quality data align before move exhaustion.",
    strategyPolicyVersion: "pr02-early-acceleration-v1",
    featureSchemaVersion: "er02-feature-contract-v1",
    datasetSchemaVersion: "er05-dataset-v1",
    period: { from: null, to: null },
    venue: "BINANCE_TR",
    universe: "tradeable-opportunity-universe",
    costAssumptions: ["configured-taker-fee", "modeled-exit-cost-optional"],
    latencyAssumptions: ["market-event-to-availableAt-segments"],
    splitManifest: null,
    variantCount: 0,
    trainUsed: false,
    validationUsed: false,
    testUsed: false,
    status: "PLANNED",
    evidenceRefs: [],
  });
}

export function ensurePr03MomentumAndRetestExperiment() {
  return registerProfitabilityExperiment({
    experimentId: "pr03-momentum-and-retest-v1",
    hypothesis:
      "Momentum continuation and breakout-retest setups require causal lifecycle transitions with frozen reference levels and flow-confirmed triggers.",
    strategyPolicyVersion: "pr03-momentum-and-retest-v1",
    featureSchemaVersion: "er02-feature-contract-v1",
    datasetSchemaVersion: "er05-dataset-v1",
    period: { from: null, to: null },
    venue: "BINANCE_TR",
    universe: "tradeable-opportunity-universe",
    costAssumptions: ["configured-taker-fee", "modeled-exit-cost-optional"],
    latencyAssumptions: ["market-event-to-availableAt-segments"],
    splitManifest: null,
    variantCount: 0,
    trainUsed: false,
    validationUsed: false,
    testUsed: false,
    status: "PLANNED",
    evidenceRefs: [],
  });
}

export function ensurePr04ExitExperiment() {
  return registerProfitabilityExperiment({
    experimentId: "pr04-exit-and-position-management-v1",
    hypothesis:
      "Versioned exit policies with structural stops, causal trailing, partial exits and time decay can be compared on matched entry manifests without changing entry thresholds.",
    strategyPolicyVersion: "pr04-exit-and-position-management-v1",
    featureSchemaVersion: "er02-feature-contract-v1",
    datasetSchemaVersion: "er05-dataset-v1",
    period: { from: null, to: null },
    venue: "BINANCE_TR",
    universe: "tradeable-opportunity-universe",
    costAssumptions: ["configured-taker-fee", "fill-price-includes-spread-flag"],
    latencyAssumptions: ["first-fill-time-anchor"],
    splitManifest: null,
    variantCount: 5,
    trainUsed: false,
    validationUsed: false,
    testUsed: false,
    status: "PLANNED",
    evidenceRefs: [],
  });
}

export function ensurePr05OfflineComparisonExperiment() {
  return registerProfitabilityExperiment({
    experimentId: "pr05-offline-comparison-v1",
    hypothesis:
      "Offline chronological comparison of EARLY, MOMENTUM and BREAKOUT strategies with versioned exit policies on matched entries and portfolio replay under net cost assumptions.",
    strategyPolicyVersion: "pr05-offline-comparison-v1",
    featureSchemaVersion: "er02-feature-contract-v1",
    datasetSchemaVersion: "er05-dataset-v1",
    period: { from: null, to: null },
    venue: "BINANCE_TR",
    universe: "tradeable-opportunity-universe",
    costAssumptions: ["configured-taker-fee", "fill-price-includes-spread-flag", "cost-stress-scenarios"],
    latencyAssumptions: ["first-fill-time-anchor", "latency-plus-1-tick-stress"],
    splitManifest: "pr05-split-manifest-v1",
    variantCount: 15,
    trainUsed: false,
    validationUsed: false,
    testUsed: false,
    status: "PLANNED",
    evidenceRefs: ["kripto-pr05-offline-comparison-and-candidate.json"],
  });
}
