import { NextRequest } from "next/server";
import { apiError, apiOkFromRequest, enforceRateLimit } from "@/lib/api";
import { checkApiToken } from "@/lib/auth";
import { env } from "@/lib/config";
import { getRequestLocale } from "@/lib/request-locale";
import { getAccountBalancesVerbose } from "@/services/binance.service";

type BalanceApiPayload = {
  platform: string;
  exchangePlatform: string;
  exchangeEnv: string;
  totalAssets: number;
  nonZeroAssets: number;
  balances: Array<{ asset: string; free: number; locked: number; total: number }>;
  error: string | null;
  errorCode: string | null;
  errorHint: string | null;
  rawError: string | null;
  updatedAt: string;
};

const BALANCE_CACHE_TTL_MS = 120_000;
const BALANCE_RATE_LIMIT_COOLDOWN_MS = 300_000;
const BALANCE_NETWORK_COOLDOWN_MS = 90_000;
let balanceCache: { payload: BalanceApiPayload; at: number } | null = null;
let balanceInFlight: Promise<BalanceApiPayload> | null = null;
let balanceCooldownUntil = 0;
let balanceCooldownError: Pick<BalanceApiPayload, "error" | "errorCode" | "errorHint" | "rawError"> | null = null;

function parseBalanceError(error: string | null, tr: boolean) {
  if (!error) {
    return { error: null, errorCode: null, errorHint: null, rawError: null };
  }
  const lower = error.toLowerCase();
  const isInvalidKey =
    lower.includes("-2015") ||
    lower.includes("invalid api-key") ||
    lower.includes("code=3701") ||
    lower.includes("code\":3701");
  const isNetwork = lower.includes("fetch failed") || lower.includes("econnreset") || lower.includes("etimedout");
  const isRateLimited = lower.includes("http 429") || lower.includes("too many requests") || lower.includes("rate limit");

  if (isInvalidKey) {
    return {
      error: tr ? "Binance TR API yetkilendirme hatasi (-2015/3701)." : "Binance TR API authorization error (-2015/3701).",
      errorCode: lower.includes("3701") ? "3701" : "-2015",
      errorHint: tr
        ? "API anahtari/secret, IP whitelist ve Spot okuma-islem izinlerini Binance TR panelinden kontrol et."
        : "Check API key/secret, IP whitelist, and Spot read-trade permissions in Binance TR panel.",
      rawError: error,
    };
  }

  if (isNetwork) {
    return {
      error: tr ? "Binance TR baglantisi su anda kararsiz." : "Binance TR connectivity is unstable right now.",
      errorCode: "NETWORK",
      errorHint: tr
        ? "Internet/DNS/VPN/Firewall ayarlarini kontrol et. Gerekirse farkli agdan tekrar dene."
        : "Check Internet/DNS/VPN/Firewall settings. Retry from a different network if needed.",
      rawError: error,
    };
  }

  if (isRateLimited) {
    return {
      error: tr
        ? "Binance TR istek limiti asildi (HTTP 429)."
        : "Binance TR request limit exceeded (HTTP 429).",
      errorCode: "429",
      errorHint: tr
        ? "Bakiye endpoint'i saniyede cok sik cagriliyor. Sistem cache ile otomatik yavaslatir; 30-60 saniye bekleyip tekrar dene."
        : "Balance endpoint is being called too frequently. System auto-throttles via cache; retry in 30-60 seconds.",
      rawError: error,
    };
  }

  return { error, errorCode: "UNKNOWN", errorHint: null, rawError: error };
}

async function loadBalancePayload(locale: "tr" | "en", forceRefresh = false): Promise<BalanceApiPayload> {
  const tr = locale === "tr";
  const now = Date.now();
  if (!forceRefresh && balanceCache && now < balanceCooldownUntil) {
    return {
      ...balanceCache.payload,
      ...(balanceCooldownError ?? {}),
      updatedAt: new Date().toISOString(),
    };
  }
  if (!forceRefresh && balanceCache && now - balanceCache.at < BALANCE_CACHE_TTL_MS) {
    return balanceCache.payload;
  }
  if (!forceRefresh && balanceInFlight) {
    return balanceInFlight;
  }

  balanceInFlight = (async () => {
    const { balances, error } = await getAccountBalancesVerbose();
    const mapped = parseBalanceError(error, tr);
    const nonZero = balances.filter((row) => row.total > 0).sort((a, b) => b.total - a.total);
    const payload: BalanceApiPayload = {
      platform: "binance",
      exchangePlatform: env.BINANCE_PLATFORM,
      exchangeEnv: env.BINANCE_ENV,
      totalAssets: balances.length,
      nonZeroAssets: nonZero.length,
      balances: nonZero.slice(0, 120),
      error: mapped.error,
      errorCode: mapped.errorCode,
      errorHint: mapped.errorHint,
      rawError: mapped.rawError,
      updatedAt: new Date().toISOString(),
    };

    // Keep last good snapshot to survive transient 429/network errors.
    if (payload.balances.length > 0) {
      balanceCache = { payload, at: Date.now() };
      balanceCooldownUntil = 0;
      balanceCooldownError = null;
      return payload;
    }
    if (payload.errorCode === "429") {
      balanceCooldownUntil = Date.now() + BALANCE_RATE_LIMIT_COOLDOWN_MS;
      balanceCooldownError = {
        error: payload.error,
        errorCode: payload.errorCode,
        errorHint: payload.errorHint,
        rawError: payload.rawError,
      };
    } else if (payload.errorCode === "NETWORK") {
      balanceCooldownUntil = Date.now() + BALANCE_NETWORK_COOLDOWN_MS;
      balanceCooldownError = {
        error: payload.error,
        errorCode: payload.errorCode,
        errorHint: payload.errorHint,
        rawError: payload.rawError,
      };
    }
    if (balanceCache) {
      // Extend cache freshness window while upstream is rate-limited/unhealthy.
      balanceCache = { payload: balanceCache.payload, at: Date.now() };
      return {
        ...balanceCache.payload,
        error: payload.error ?? balanceCache.payload.error,
        errorCode: payload.errorCode ?? balanceCache.payload.errorCode,
        errorHint: payload.errorHint ?? balanceCache.payload.errorHint,
        rawError: payload.rawError ?? balanceCache.payload.rawError,
        updatedAt: new Date().toISOString(),
      };
    }
    return payload;
  })();

  try {
    return await balanceInFlight;
  } finally {
    balanceInFlight = null;
  }
}

export async function GET(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";
  const limited = enforceRateLimit(request);
  if (limited) return limited;
  if (!checkApiToken(request)) return apiError(tr ? "Yetkisiz." : "Unauthorized.", 401);

  const forceRefresh = request.nextUrl.searchParams.get("force") === "1";
  const payload = await loadBalancePayload(tr ? "tr" : "en", forceRefresh);
  return apiOkFromRequest(request, payload);
}

