export type PublicMarketRestKind =
  | "ticker"
  | "prices"
  | "dailyStats"
  | "klines"
  | "orderBook"
  | "recentTrades"
  | "exchangeInfo"
  | "other";

export type PublicMarketRestCall = {
  at: number;
  kind: PublicMarketRestKind;
  path?: string;
  symbol?: string;
  source: string;
  recovery: boolean;
};

const MAX_LOG = 400;
const calls: PublicMarketRestCall[] = [];
let restCallsThisMinute = 0;
let minuteBucket = 0;

export function recordPublicMarketRestCall(call: Omit<PublicMarketRestCall, "at"> & { at?: number }) {
  const now = Date.now();
  const bucket = Math.floor(now / 60_000);
  if (bucket !== minuteBucket) {
    minuteBucket = bucket;
    restCallsThisMinute = 0;
  }
  restCallsThisMinute += 1;
  calls.push({
    at: call.at ?? now,
    kind: call.kind,
    path: call.path,
    symbol: call.symbol,
    source: call.source,
    recovery: call.recovery,
  });
  if (calls.length > MAX_LOG) calls.splice(0, calls.length - MAX_LOG);
}

export function getPublicMarketRestCalls() {
  return [...calls];
}

export function getPublicMarketRestCallsPerMinute() {
  const bucket = Math.floor(Date.now() / 60_000);
  if (bucket !== minuteBucket) return 0;
  return restCallsThisMinute;
}

export function countHotPathPublicMarketRestCalls(sinceMs?: number) {
  const cutoff = sinceMs ?? 0;
  return calls.filter((row) => !row.recovery && row.at >= cutoff).length;
}

export function resetPublicMarketRestAudit() {
  calls.length = 0;
  restCallsThisMinute = 0;
}
