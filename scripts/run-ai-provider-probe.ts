/**
 * Live AI provider connectivity probe — no trading.
 * Tests each enabled provider × lane independently.
 */
import fs from "node:fs";
import path from "node:path";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i === -1) continue;
  const k = line.slice(0, i);
  const v = line.slice(i + 1);
  if (!(k in process.env)) process.env[k] = v;
}

const ROOT = process.cwd();
const OUT_CSV = path.join(ROOT, "kripto-ai-provider-health-final.csv");

type Lane = "technical" | "momentum" | "risk";

function buildInput() {
  return {
    symbol: "BTCTRY",
    lastPrice: 3_700_000,
    spread: 0.05,
    volatility: 1.2,
    volume24h: 1_000_000_000,
    klines: Array.from({ length: 60 }, (_, i) => ({
      open: 3_700_000 + i * 100,
      high: 3_700_100 + i * 100,
      low: 3_699_900 + i * 100,
      close: 3_700_000 + i * 100,
      volume: 100,
      time: Date.now() - i * 60_000,
    })),
    orderBookSummary: { bidDepth: 100, askDepth: 100, bestBid: 3_699_999, bestAsk: 3_700_001 },
    recentTradesSummary: { buySellRatio: 1.05 },
    marketSignals: { change24h: 1.2, shortMomentumPercent: 0.3 },
    strategyParams: {},
    riskSettings: {},
  };
}

async function main() {
  const { getProviderConfigs } = await import("@/src/server/ai/provider-registry");
  const { analyzeWithRemoteModel, clearRemoteProviderStateForTests } = await import(
    "@/src/server/ai/providers/remote-llm"
  );

  clearRemoteProviderStateForTests();
  const configs = getProviderConfigs();
  const input = buildInput();
  const lanes: Lane[] = ["technical", "momentum", "risk"];
  const rows: (string | number)[][] = [];
  let healthy = 0;
  let total = 0;

  for (const cfg of configs) {
    const hasKey = Boolean(cfg.apiKey?.trim());
    for (const lane of lanes) {
      total += 1;
      const t0 = Date.now();
      let status = "FAIL";
      let remoteOk = "NO";
      let errorType = "";
      let latencyMs = 0;
      try {
        const out = await analyzeWithRemoteModel(cfg, input, lane);
        latencyMs = Date.now() - t0;
        if (out && (out.metadata?.remoteOk || out.metadata?.remote)) {
          status = "HEALTHY";
          remoteOk = "YES";
          healthy += 1;
        } else if (out) {
          status = "INVALID";
          errorType = "missing_remote_flag";
        } else {
          status = "NULL";
          errorType = "remote_returned_null";
        }
      } catch (e) {
        latencyMs = Date.now() - t0;
        errorType = (e as Error).message.slice(0, 120);
      }
      rows.push([
        cfg.id,
        cfg.name,
        cfg.model ?? "",
        lane,
        hasKey ? "YES" : "NO",
        status,
        remoteOk,
        latencyMs,
        errorType,
      ]);
    }
  }

  const rate = total > 0 ? healthy / total : 0;
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return s.includes(",") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const headers = ["providerId", "name", "model", "lane", "authPresent", "status", "remoteOk", "latencyMs", "errorType"];
  fs.writeFileSync(OUT_CSV, `${headers.join(",")}\n${rows.map((r) => r.map(esc).join(",")).join("\n")}\n`, "utf8");

  const summary = {
    configured: configs.length,
    probesTotal: total,
    healthy,
    healthyRate: Number(rate.toFixed(4)),
    gatePass: healthy > 0 && rate >= 0.67,
    rows,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.gatePass ? 0 : 1);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
