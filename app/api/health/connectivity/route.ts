import { env } from "@/lib/config";
import { apiOk } from "@/lib/api";

type ProbeResult = {
  id: string;
  label: string;
  url: string;
  ok: boolean;
  statusCode: number | null;
  latencyMs: number;
  error: string | null;
  checkedAt: string;
};

async function probe(id: string, label: string, url: string, timeoutMs = 7000): Promise<ProbeResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    return {
      id,
      label,
      url,
      ok: response.ok,
      statusCode: response.status,
      latencyMs: Date.now() - startedAt,
      error: response.ok ? null : `HTTP ${response.status}`,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      id,
      label,
      url,
      ok: false,
      statusCode: null,
      latencyMs: Date.now() - startedAt,
      error: (error as Error).message,
      checkedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  const checks =
    env.EXCHANGE_PROVIDER === "okx"
      ? await Promise.all([
          probe("okx-public-time", "OKX Public Time", "https://www.okx.com/api/v5/public/time"),
          probe(
            "okx-public-spot",
            "OKX Public Instruments",
            "https://www.okx.com/api/v5/public/instruments?instType=SPOT",
          ),
          probe("okx-web", "OKX Web", "https://www.okx.com"),
        ])
      : await Promise.all([
          probe(
            "binancetr-api",
            "BinanceTR API",
            `${env.BINANCE_TR_HTTP_BASE.replace(/\/+$/, "")}/api/v3/time`,
          ),
          probe("binancetr-mbx", "BinanceTR MBX API", "https://api.binance.me/api/v3/time"),
          probe("binancetr-web", "BinanceTR Web", env.BINANCE_TR_HTTP_BASE.replace(/\/+$/, "")),
        ]);

  const okCount = checks.filter((row) => row.ok).length;
  const status = okCount === checks.length ? "healthy" : okCount > 0 ? "degraded" : "down";

  return apiOk({
    status,
    okCount,
    total: checks.length,
    provider: env.EXCHANGE_PROVIDER,
    exchangeEnv: env.EXCHANGE_PROVIDER === "okx" ? env.OKX_ENV : env.BINANCE_ENV,
    checkedAt: new Date().toISOString(),
    checks,
  });
}

