type RoundPipelineTelemetryEntry = {
  at: string;
  jobId: string;
  runId: string;
  roundNo: number;
  stage: string;
  payload: Record<string, unknown>;
};

const buffer = new Map<string, RoundPipelineTelemetryEntry[]>();
const MAX_PER_ROUND = 24;

export function recordRoundPipelineTelemetry(input: {
  jobId: string;
  runId: string;
  roundNo: number;
  stage: string;
  payload: Record<string, unknown>;
}) {
  const key = `${input.jobId}:${input.roundNo}`;
  const rows = buffer.get(key) ?? [];
  rows.push({
    at: new Date().toISOString(),
    jobId: input.jobId,
    runId: input.runId,
    roundNo: input.roundNo,
    stage: input.stage,
    payload: input.payload,
  });
  if (rows.length > MAX_PER_ROUND) rows.splice(0, rows.length - MAX_PER_ROUND);
  buffer.set(key, rows);
}

export function getRoundPipelineTelemetry(jobId: string, roundNo: number) {
  return buffer.get(`${jobId}:${roundNo}`) ?? [];
}

export function summarizeRoundPipelineTelemetry(jobId: string, roundNo: number) {
  const rows = getRoundPipelineTelemetry(jobId, roundNo);
  const stageCounts: Record<string, number> = {};
  for (const row of rows) {
    stageCounts[row.stage] = (stageCounts[row.stage] ?? 0) + 1;
  }
  const latest = rows[rows.length - 1] ?? null;
  return { stageCounts, latest, sampleCount: rows.length };
}

export function resetRoundPipelineTelemetryForTests() {
  buffer.clear();
}
