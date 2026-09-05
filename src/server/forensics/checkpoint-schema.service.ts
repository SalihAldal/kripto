type JsonRecord = Record<string, unknown>;

const REQUIRED_PATHS = [
  "campaignId",
  "generatedAt",
  "runId",
  "roundId",
  "marketData.coveragePct",
  "marketData.universeSize",
  "marketData.liveSymbols",
  "pipelineFunnel",
  "authority.aiHardVetoCount",
  "scanner.shadowOutcomeFinalizer",
  "resources.cpuPercent",
  "resources.eventLoopLagP95Ms",
  "resources.redisLatencyMs",
  "resources.memory.rssMB",
  "resources.memory.heapUsedMB",
  "resources.memory.heapTotalMB",
  "resources.memory.externalMB",
  "breaker.domains",
  "breaker.summary.open",
  "ws.lightSocketState",
  "ws.deepSocketState",
  "rest.publicMarketRestPerMin",
] as const;

function readPath(input: JsonRecord, dotPath: string) {
  const keys = dotPath.split(".");
  let cursor: unknown = input;
  for (const key of keys) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as JsonRecord)[key];
  }
  return cursor;
}

export function validateCheckpointSchema(snapshot: JsonRecord) {
  const missing = REQUIRED_PATHS.filter((dotPath) => {
    const value = readPath(snapshot, dotPath);
    return value == null;
  });
  return {
    required: [...REQUIRED_PATHS],
    missing,
    ok: missing.length === 0,
    code: missing.length === 0 ? "CHECKPOINT_SCHEMA_OK" : "CHECKPOINT_SCHEMA_INCOMPLETE",
  };
}
