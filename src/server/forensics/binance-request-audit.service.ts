type BinanceRequestAudit = {
  endpoint: string;
  latencyMs: number;
  status: number | "timeout" | "error";
  retry: number;
  backoffMs: number;
  timestamp: string;
};

const audits: BinanceRequestAudit[] = [];

export function recordBinanceRequest(input: Omit<BinanceRequestAudit, "timestamp"> & { timestamp?: string }) {
  const row: BinanceRequestAudit = {
    ...input,
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
  audits.push(row);
  if (audits.length > 500) audits.shift();
  return row;
}

export function classifyBinanceFailure(status: number | "timeout" | "error") {
  if (status === 429) return "RATE_LIMIT";
  if (status === "timeout") return "TIMEOUT";
  if (typeof status === "number" && status >= 500) return "SERVER_ERROR";
  if (status === "error") return "NETWORK_ERROR";
  return "REQUEST_FAILED";
}

export function assertBinanceFailureIsExplicit(input: {
  endpoint: string;
  status: number | "timeout" | "error";
  candidateCount: number;
}) {
  if (input.candidateCount === 0 && (input.status === 429 || input.status === "timeout" || input.status === "error")) {
    return {
      explicit: true,
      reasonCode: classifyBinanceFailure(input.status),
      reasonDetail: `Binance ${input.endpoint} failed with ${input.status}; zero candidates is not silent success`,
    };
  }
  return { explicit: input.candidateCount > 0 || input.status === 200, reasonCode: "OK", reasonDetail: "" };
}

export function getRecentBinanceAudits(limit = 50) {
  return audits.slice(-limit);
}
