import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { aiModelOutputSchema } from "@/src/server/ai/ai-output.schema";
import { normalizeAiModelOutput } from "@/src/server/ai/normalize-model-output";
import { clampScore } from "@/src/server/ai/utils";
import type { AIAnalysisInput, AIDecision, AIModelOutput, AIProviderConfig } from "@/src/types/ai";

type ProviderKind = "openai" | "anthropic" | "gemini";
type AnalysisLane = "technical" | "momentum" | "risk";

type ParsedModelOutput = {
  decision?: string;
  confidence?: number;
  riskScore?: number;
  targetPrice?: number | null;
  stopPrice?: number | null;
  expectedMovePercent?: number;
  expectedMoveRange?: { min: number; max: number };
  targetPercent?: number;
  stopPercent?: number;
  timeHorizonMinutes?: number;
  riskReason?: string;
  invalidationReason?: string;
  estimatedDurationSec?: number;
  reasoningShort?: string;
};

const geminiJsonResponseSchema = {
  type: "object",
  properties: {
    decision: { type: "string", enum: ["BUY", "SELL", "HOLD", "NO_TRADE"] },
    confidence: { type: "number" },
    riskScore: { type: "number" },
    targetPrice: { type: "number", nullable: true },
    stopPrice: { type: "number", nullable: true },
    expectedMovePercent: { type: "number" },
    expectedMoveRange: {
      type: "object",
      properties: {
        min: { type: "number" },
        max: { type: "number" },
      },
      required: ["min", "max"],
    },
    targetPercent: { type: "number" },
    stopPercent: { type: "number" },
    timeHorizonMinutes: { type: "number" },
    estimatedDurationSec: { type: "number" },
    riskReason: { type: "string" },
    invalidationReason: { type: "string" },
    reasoningShort: { type: "string" },
  },
  required: [
    "decision",
    "confidence",
    "riskScore",
    "targetPrice",
    "stopPrice",
    "expectedMovePercent",
    "expectedMoveRange",
    "targetPercent",
    "stopPercent",
    "timeHorizonMinutes",
    "estimatedDurationSec",
    "riskReason",
    "invalidationReason",
    "reasoningShort",
  ],
} as const;

const CACHE_TTL_MS = 12_000;
const resultCache = new Map<string, { expiresAt: number; value: AIModelOutput }>();
const inflight = new Map<string, Promise<AIModelOutput | null>>();
const MODEL_CACHE_TTL_MS = 10 * 60_000;
const anthropicModelCache = new Map<string, { expiresAt: number; models: string[] }>();
const geminiModelCache = new Map<string, { expiresAt: number; models: string[] }>();
const providerBackoffUntil = new Map<string, number>();
const warnThrottle = new Map<string, number>();

function shouldWarn(key: string, intervalMs = 10_000) {
  const now = Date.now();
  const last = warnThrottle.get(key) ?? 0;
  if (now - last < intervalMs) return false;
  warnThrottle.set(key, now);
  return true;
}

function isTransientRemoteFailure(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("http 429") ||
    lower.includes("http 500") ||
    lower.includes("http 502") ||
    lower.includes("http 503") ||
    lower.includes("http 504") ||
    lower.includes("timeout") ||
    lower.includes("aborted") ||
    lower.includes("server_error") ||
    lower.includes("unavailable") ||
    lower.includes("high demand")
  );
}

function classifyRemoteAiFailure(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("json") || lower.includes("schema") || lower.includes("valid output")) return "json_output";
  if (lower.includes("model") || lower.includes("404") || lower.includes("not found")) return "model";
  if (lower.includes("timeout") || lower.includes("aborted")) return "timeout";
  if (lower.includes("429") || lower.includes("rate limit")) return "rate_limit";
  if (lower.includes("mime") || lower.includes("modality") || lower.includes("responsemimetype")) return "modality";
  return "remote";
}

function isSupportedGeminiTextModel(model: string) {
  const lower = model.toLowerCase();
  if (!lower.startsWith("gemini-")) return false;
  if (
    lower.includes("tts") ||
    lower.includes("audio") ||
    lower.includes("image") ||
    lower.includes("embedding") ||
    lower.includes("aqa") ||
    lower.includes("vision")
  ) {
    return false;
  }
  if (lower.includes("preview") && !lower.includes("flash") && !lower.includes("pro")) return false;
  return lower.includes("flash") || lower.includes("pro");
}

function detectProvider(config: AIProviderConfig): ProviderKind | null {
  const lower = `${config.id} ${config.name}`.toLowerCase();
  const apiKey = config.apiKey?.trim() ?? "";
  if (apiKey.startsWith("sk-ant-")) return "anthropic";
  if (apiKey.startsWith("AIza")) return "gemini";
  if (apiKey.startsWith("sk-")) return "openai";

  if (
    lower.includes("openai") ||
    lower.includes("gpt") ||
    lower.includes("chatgpt") ||
    lower.includes("o1") ||
    lower.includes("o3")
  ) {
    return "openai";
  }
  if (lower.includes("claude") || lower.includes("anthropic") || lower.includes("sonnet") || lower.includes("haiku")) {
    return "anthropic";
  }
  if (lower.includes("gemini") || lower.includes("google")) return "gemini";
  return null;
}

function safeJsonParse(raw: string) {
  try {
    return JSON.parse(raw) as ParsedModelOutput;
  } catch {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(raw.slice(first, last + 1)) as ParsedModelOutput;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function extractBalancedJsonCandidates(raw: string) {
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === "}") {
      if (depth > 0) depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(raw.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return candidates;
}

function normalizeJsonLikeText(raw: string) {
  return raw
    .replace(/^\uFEFF/, "")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/\r/g, "")
    .trim();
}

function parseLenientModelOutput(raw: string): ParsedModelOutput | null {
  const normalized = normalizeJsonLikeText(raw);
  const direct = safeJsonParse(normalized);
  if (direct) {
    return direct;
  }

  const fenced = normalized.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    const parsedFence = safeJsonParse(fenced.trim());
    if (parsedFence) {
      return parsedFence;
    }
  }

  for (const candidate of extractBalancedJsonCandidates(normalized)) {
    const parsedCandidate = safeJsonParse(candidate);
    if (parsedCandidate) {
      return parsedCandidate;
    }
  }

  return null;
}

function normalizeDecision(raw: string | undefined): AIDecision {
  const upper = (raw ?? "").trim().toUpperCase();
  if (upper === "BUY" || upper === "SELL" || upper === "HOLD" || upper === "NO_TRADE") return upper;
  return "NO_TRADE";
}

function normalizeSchemaText(value: unknown, fallback: string, maxLength: number) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  const safe = text.length >= 6 ? text : fallback;
  return safe.slice(0, maxLength);
}

function buildPrompt(input: AIAnalysisInput, lane: AnalysisLane) {
  const shortCloses = input.klines.slice(-12).map((x) => x.close);
  const shortAvg = shortCloses.reduce((acc, x) => acc + x, 0) / Math.max(shortCloses.length, 1);
  const trend = ((input.lastPrice - shortAvg) / Math.max(shortAvg, 0.0001)) * 100;
  const orderBookImbalance =
    (input.orderBookSummary.bidDepth - input.orderBookSummary.askDepth) /
    Math.max(input.orderBookSummary.bidDepth + input.orderBookSummary.askDepth, 0.0001);
  const analysisProfile = String(input.strategyParams?.analysisProfile ?? "STANDARD");
  const analystMode = String(input.strategyParams?.analystMode ?? "strict");
  const objective = String(input.strategyParams?.objective ?? "");
  const leverageRequested = input.riskSettings?.maxLeverage ?? "n/a";
  const maxDurationHint = lane === "risk" ? 3600 : lane === "momentum" ? 5400 : 7200;

  // Compute MA7, MA25, MA99 from 1m klines closes for prompt enrichment
  const allCloses = input.klines.map((x) => x.close);
  const computeMA = (closes: number[], period: number) => {
    const slice = closes.slice(-period);
    return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
  };
  const ma7 = computeMA(allCloses, 7);
  const ma25 = computeMA(allCloses, 25);
  const ma99 = computeMA(allCloses, 99);
  const maAlignment =
    input.lastPrice > ma7 && ma7 > ma25 && ma25 > ma99
      ? "STRONG_UPTREND"
      : input.lastPrice < ma7 && ma7 < ma25 && ma25 < ma99
        ? "STRONG_DOWNTREND"
        : Math.abs(ma7 - ma25) / Math.max(ma25, 0.0001) < 0.005
          ? "COMPRESSION"
          : "MIXED";

  // Last 2 candle volumes for volume trend detection
  const recentVols = input.klines.slice(-3).map((x) => x.volume);
  const lastVol = recentVols[recentVols.length - 1] ?? 0;
  const prevVol = recentVols[recentVols.length - 2] ?? 0;
  const volumeTrend = prevVol > 0 ? ((lastVol - prevVol) / prevVol) * 100 : 0;

  const technicalSpecialistMode = lane === "technical";
  const sentimentSpecialistMode = lane === "momentum";
  const riskSpecialistMode = lane === "risk";
  const proTraderRules = [
    "Think like a professional smart-money trader; never trade randomly or on a single indicator.",
    "Short-term only: scalp/intraday. No swing trades. Max duration 3 hours.",
    "Multi-timeframe: HTF (4H/1H) defines bias, LTF (15M/5M/1M) is for entries. No strong countertrend trades.",
    "Trend: HH/HL=BULL, LH/LL=BEAR, range=SIDEWAYS. Countertrend only with strong CHOCH/liquidity sweep/divergence.",
    "Trend via MA alignment: price above MA7 > MA25 > MA99 = strong uptrend; below MA7 = short-term weakness; MAs converging = compression, breakout imminent.",
    "Structure: BOS=continuation, CHOCH/MSS=possible reversal; require volume confirmation.",
    "Liquidity: equal highs/lows, prior highs/lows; sweep + rejection is strong.",
    "Support/Resistance via order book: dense bid clusters = support; dense ask clusters = resistance. Level tested 2+ times = critical; treat as key S/R.",
    "SMC: order block + FVG/imbalance; OB+liquidity+BOS strongest.",
    "Volume on uptrend: increasing volume = strong continuation; decreasing volume = pump weakening, caution.",
    "Volume on downtrend: increasing volume = strong sell pressure, danger; decreasing volume = possible dip bottom.",
    "Volume: high-volume breakout validates; low-volume breakout is weak; spikes may be manipulation.",
    "Momentum signals: same resistance tested 2+ times and not broken = weakness; post-pump flat candles with low volume = distribution phase.",
    "Momentum/EMA: RSI/MACD as confirmation; EMA20/50/200 as filter only.",
    "Conflicting signals: if volume strong but resistance not breaking, state conflict explicitly in reasoningShort.",
    "Volatility: higher vol => higher risk; adjust stop. Avoid chaotic markets.",
    "No-trade if structure unclear, HTF/LTF conflict, weak RR, manipulation risk, or weak volume.",
    "Risk: stop required, risk 1% max, avoid overleverage; survival > frequency.",
    "Never take excessive risk concurrently; preserve capital above all.",
    "Daily max loss 5%: prefer NO_TRADE once loss risk escalates.",
    "After 3 consecutive losses, stop trading and output NO_TRADE.",
    "If volatility is extreme, reduce size and be stricter; avoid aggressive entries.",
    "Avoid aggressive trades during high-impact news windows.",
    "Require RR >= 1:2; otherwise NO_TRADE.",
    "Filter low-confidence setups; low quality => NO_TRADE.",
    "Block trades under manipulation suspicion or abnormal spikes.",
    "Market regime rules: trending markets avoid counter-trend fades; ranging markets avoid breakout chasing.",
    "Low volatility markets require patience; prefer mean reversion or NO_TRADE unless clean expansion.",
    "News-driven markets require extra caution; avoid chasing spikes without confirmation.",
    "Never guarantee a price target; always express expectations as probabilities.",
    "If an active position exists for this symbol, focus ONLY on that symbol; do not scan others.",
  ];
  return [
    "You are a professional crypto scalping and short-term momentum analyst. You must express probabilistic, numeric, and disciplined outputs.",
    "Never say 'guaranteed' or 'definitely'; avoid absolute promises. If unsure, output decision=NO_TRADE.",
    technicalSpecialistMode
      ? "You are an elite TECHNICAL ANALYSIS specialist. Focus ONLY on technical structure."
      : sentimentSpecialistMode
        ? "You are an elite MARKET CONTEXT + NEWS + MOMENTUM specialist. Focus on sentiment quality only."
        : riskSpecialistMode
          ? "You are an elite RISK MANAGER and VETO ENGINE. Default behavior is protective."
          : "You are a strict short-horizon crypto analyst.",
    `Analysis profile=${analysisProfile} mode=${analystMode}`,
    "Return ONLY compact JSON. No markdown, no prose, no code fences.",
    "Required keys:",
    "decision, confidence, riskScore, targetPrice, stopPrice, expectedMovePercent, expectedMoveRange, targetPercent, stopPercent, timeHorizonMinutes, estimatedDurationSec, riskReason, invalidationReason, reasoningShort",
    ...(technicalSpecialistMode
      ? [
          "Technical lane rules:",
          "- Evaluate: market structure (HH/HL, LH/LL), BOS, CHoCH, trend continuation/reversal",
          "- Use support/resistance, dynamic levels, breakout/retest quality",
          "- Use indicators together: RSI, MACD, BB, EMA/SMA, ATR, Stoch RSI, VWAP, volume behaviour",
          "- Include price action logic: wick/rejection, engulfing, inside-bar, impulsive vs corrective",
          "- Respect multi-timeframe: 4h/1h direction, 15m/5m entry",
          "- If structure is unclear or conflicting, output decision=NO_TRADE",
          "- Do NOT include news or risk approval commentary",
        ]
      : sentimentSpecialistMode
        ? [
            "Sentiment lane rules:",
            "- Evaluate market context: BTC direction impact, altcoin appetite, dominance pressure, risk appetite",
            "- Evaluate coin momentum quality: sustainable vs weak vs post-spike fade risk",
            "- Separate hype/FOMO from real momentum supported by flow + volume",
            "- Evaluate news bias: POSITIVE / NEGATIVE / NEUTRAL from available context",
            "- If no reliable news signal exists, explicitly state it briefly in reasoningShort",
            "- Do NOT define technical entry/stop/take-profit strategy",
            "- If context is unclear or momentum is hype-driven, prefer decision=NO_TRADE",
          ]
        : riskSpecialistMode
          ? [
              "Risk lane rules:",
              "- Audit technical/sentiment opportunities from risk-first perspective",
              "- Veto when spread/volatility/liquidity/uncertainty are unsafe",
              "- Veto when conditions imply open-position conflict or cooldown risk",
              "- Prefer NO_TRADE under ambiguity, never blind-approve other lanes",
              "- Validate stop/target realism and basic order safety assumptions",
              "- Keep output protective; avoid aggressive assumptions",
            ]
      : []),
    "Rules:",
    "- decision must be one of BUY, SELL, HOLD, NO_TRADE",
    "- confidence and riskScore are 0..100",
    "- reasoningShort max 120 chars",
    ...(analysisProfile === "LEVERAGE_DEEP"
      ? [
          "- Prefer NO_TRADE unless directional edge is statistically strong.",
          "- For leveraged suitability require high confidence and low risk.",
          "- Avoid overfitting; prioritize spread, volatility, and liquidity realism.",
        ]
      : []),
    "Pro-trader rules:",
    ...proTraderRules.map((rule) => `- ${rule}`),
    "",
    `Lane=${lane}`,
    `Symbol=${input.symbol}`,
    `lastPrice=${input.lastPrice}`,
    `spreadPercent=${input.spread}`,
    `volatilityPercent=${input.volatility}`,
    `volume24hQuote=${input.volume24h}`,
    `buySellRatio=${input.recentTradesSummary.buySellRatio}`,
    `orderBookImbalance=${orderBookImbalance}`,
    `trend12barsPercent=${Number(trend.toFixed(4))}`,
    `ma7=${Number(ma7.toFixed(8))}`,
    `ma25=${Number(ma25.toFixed(8))}`,
    `ma99=${Number(ma99.toFixed(8))}`,
    `maAlignment=${maAlignment}`,
    `volumeTrendPercent=${Number(volumeTrend.toFixed(2))}`,
    `bidDepth=${Number(input.orderBookSummary.bidDepth.toFixed(2))}`,
    `askDepth=${Number(input.orderBookSummary.askDepth.toFixed(2))}`,
    `bestBid=${input.orderBookSummary.bestBid}`,
    `bestAsk=${input.orderBookSummary.bestAsk}`,
    `change24hPercent=${Number((input.marketSignals?.change24h ?? 0).toFixed(4))}`,
    `shortMomentumPercent=${Number((input.marketSignals?.shortMomentumPercent ?? 0).toFixed(4))}`,
    `maxDurationHintSec=${maxDurationHint}`,
    `risk.maxDailyLossPercent=${input.riskSettings?.maxDailyLossPercent ?? "n/a"}`,
    `risk.maxLeverage=${leverageRequested}`,
    `objective=${objective || "n/a"}`,
  ].join("\n");
}

async function postJson(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(800, timeoutMs));
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status} ${body.slice(0, 220)}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function getJson(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(800, timeoutMs));
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status} ${body.slice(0, 220)}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function callOpenAI(apiKey: string, prompt: string, timeoutMs: number) {
  const json = await postJson(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: env.AI_PROVIDER_1_MODEL ?? "gpt-4o-mini",
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "Output only compact JSON object. No markdown, no prose, no code fences.",
          },
          { role: "user", content: prompt },
        ],
      }),
    },
    timeoutMs,
  ) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? "";
}

async function callAnthropic(apiKey: string, prompt: string, timeoutMs: number) {
  const models = await resolveAnthropicModels(apiKey, timeoutMs);
  let lastError: unknown = null;
  for (const model of models) {
    try {
      const json = await postJson(
        "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: 120,
            messages: [{ role: "user", content: prompt }],
          }),
        },
        timeoutMs,
      ) as { content?: Array<{ type?: string; text?: string }> };
      return json.content?.find((x) => x.type === "text")?.text ?? "";
    } catch (error) {
      lastError = error;
      const message = String((error as Error).message ?? "");
      const failureCategory = classifyRemoteAiFailure(message);
      if (message.includes("404") || failureCategory === "modality" || failureCategory === "model" || isTransientRemoteFailure(message)) continue;
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Anthropic model resolution failed");
}

async function callGemini(apiKey: string, prompt: string, timeoutMs: number) {
  const models = await resolveGeminiModels(apiKey, timeoutMs);
  let lastError: unknown = null;
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    try {
      const buildBody = (jsonMime: boolean) => ({
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 768,
          ...(jsonMime
            ? {
                responseMimeType: "application/json",
                responseSchema: geminiJsonResponseSchema,
              }
            : {}),
        },
        contents: [{ parts: [{ text: prompt }] }],
      });
      const request = async (jsonMime: boolean, requestPrompt = prompt) =>
        postJson(
          url,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...buildBody(jsonMime),
              contents: [{ parts: [{ text: requestPrompt }] }],
            }),
          },
          timeoutMs,
        );
      let json: {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
      };
      try {
        json = await request(true) as typeof json;
      } catch (error) {
        const message = String((error as Error).message ?? "");
        if (!message.toLowerCase().includes("responsemimetype") && !message.toLowerCase().includes("mime")) {
          throw error;
        }
        json = await request(false) as typeof json;
      }
      const candidateTexts = (json.candidates ?? [])
        .flatMap((candidate) => candidate.content?.parts ?? [])
        .map((part) => String(part.text ?? "").trim())
        .filter(Boolean);
      const raw = candidateTexts.join("\n");
      if (parseLenientModelOutput(raw)) return raw;

      const repairPrompt = [
        "Convert the following model output into ONE valid compact JSON object only.",
        "Do not add markdown, comments, or prose.",
        "Use exactly these keys: decision, confidence, riskScore, targetPrice, stopPrice, expectedMovePercent, expectedMoveRange, targetPercent, stopPercent, timeHorizonMinutes, estimatedDurationSec, riskReason, invalidationReason, reasoningShort.",
        "If a numeric value is missing, infer conservatively. decision must be BUY, SELL, HOLD, or NO_TRADE.",
        "",
        raw.slice(0, 1800),
      ].join("\n");
      json = await request(true, repairPrompt) as typeof json;
      const repaired = (json.candidates ?? [])
        .flatMap((candidate) => candidate.content?.parts ?? [])
        .map((part) => String(part.text ?? "").trim())
        .filter(Boolean)
        .join("\n");
      return repaired || raw;
    } catch (error) {
      lastError = error;
      const message = String((error as Error).message ?? "");
      if (message.includes("404") || isTransientRemoteFailure(message)) continue;
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Gemini model resolution failed");
}

async function resolveAnthropicModels(apiKey: string, timeoutMs: number) {
  const cached = anthropicModelCache.get(apiKey);
  if (cached && cached.expiresAt > Date.now() && cached.models.length > 0) {
    return cached.models;
  }

  const preferred = [
    env.AI_PROVIDER_2_MODEL,
    "claude-3-haiku-20240307",
    "claude-3-5-haiku-latest",
    "claude-3-5-sonnet-latest",
    "claude-3-sonnet-20240229",
    "claude-3-5-sonnet-20240620",
    "claude-3-7-sonnet-latest",
    "claude-sonnet-4-0",
  ].filter((model): model is string => Boolean(model));
  try {
    const json = await getJson(
      "https://api.anthropic.com/v1/models",
      {
        method: "GET",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
      },
      timeoutMs,
    ) as { data?: Array<{ id?: string }> };
    const available = (json.data ?? [])
      .map((x) => String(x.id ?? "").trim())
      .filter(Boolean);
    const ranked = Array.from(new Set([...preferred.filter((m) => available.includes(m)), ...available]));
    const models = ranked.length > 0 ? ranked : preferred;
    anthropicModelCache.set(apiKey, { expiresAt: Date.now() + MODEL_CACHE_TTL_MS, models });
    return models;
  } catch {
    anthropicModelCache.set(apiKey, { expiresAt: Date.now() + 60_000, models: preferred });
    return preferred;
  }
}

async function resolveGeminiModels(apiKey: string, timeoutMs: number) {
  const cached = geminiModelCache.get(apiKey);
  if (cached && cached.expiresAt > Date.now() && cached.models.length > 0) {
    return cached.models;
  }

  const preferred = [
    env.AI_PROVIDER_3_MODEL,
    "gemini-2.0-flash",
    "gemini-1.5-flash-latest",
    "gemini-2.0-flash-lite",
    "gemini-1.5-pro-latest",
  ].filter((model): model is string => Boolean(model && isSupportedGeminiTextModel(model)));
  try {
    const json = await getJson(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
      { method: "GET" },
      timeoutMs,
    ) as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> };
    const available = (json.models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m) => String(m.name ?? "").replace(/^models\//, "").trim())
      .filter((model) => Boolean(model) && isSupportedGeminiTextModel(model));
    const ranked = Array.from(new Set([...preferred.filter((m) => available.includes(m)), ...available]));
    const models = ranked.length > 0 ? ranked : preferred;
    geminiModelCache.set(apiKey, { expiresAt: Date.now() + MODEL_CACHE_TTL_MS, models });
    return models;
  } catch {
    geminiModelCache.set(apiKey, { expiresAt: Date.now() + 60_000, models: preferred });
    return preferred;
  }
}

function toOutput(
  parsed: ParsedModelOutput | null,
  input: AIAnalysisInput,
  lane: AnalysisLane,
  providerName: string,
): AIModelOutput | null {
  if (!parsed) return null;
  const decision = normalizeDecision(parsed.decision);
  const defaultDelta = lane === "momentum" ? 0.004 : lane === "risk" ? 0.003 : 0.0055;
  const fallbackTarget =
    decision === "BUY"
      ? Number((input.lastPrice * (1 + defaultDelta)).toFixed(8))
      : decision === "SELL"
        ? Number((input.lastPrice * (1 - defaultDelta)).toFixed(8))
        : null;
  const fallbackStop =
    decision === "BUY"
      ? Number((input.lastPrice * (1 - defaultDelta * 0.7)).toFixed(8))
      : decision === "SELL"
        ? Number((input.lastPrice * (1 + defaultDelta * 0.7)).toFixed(8))
        : null;
  const expectedMovePercent = Math.max(
    0.1,
    Math.min(100, Number(parsed.expectedMovePercent ?? parsed.targetPercent ?? defaultDelta * 100)),
  );
  const expectedRangeMin = Math.max(0.0001, Number(parsed.expectedMoveRange?.min ?? expectedMovePercent * 0.5));
  const expectedRangeMax = Math.max(
    expectedRangeMin,
    Number(parsed.expectedMoveRange?.max ?? Math.max(expectedMovePercent, expectedRangeMin)),
  );
  const schemaResult = aiModelOutputSchema.safeParse({
    decision,
    confidence: clampScore(typeof parsed.confidence === "number" ? parsed.confidence : 0),
    riskScore: clampScore(typeof parsed.riskScore === "number" ? parsed.riskScore : 70),
    targetPrice: typeof parsed.targetPrice === "number" && Number.isFinite(parsed.targetPrice) && parsed.targetPrice > 0 ? parsed.targetPrice : fallbackTarget,
    stopPrice: typeof parsed.stopPrice === "number" && Number.isFinite(parsed.stopPrice) && parsed.stopPrice > 0 ? parsed.stopPrice : fallbackStop,
    expectedMovePercent: Math.max(expectedRangeMin, Math.min(expectedRangeMax, expectedMovePercent)),
    expectedMoveRange: {
      min: expectedRangeMin,
      max: expectedRangeMax,
    },
    targetPercent: Math.max(0, Math.min(100, Number(parsed.targetPercent ?? expectedMovePercent))),
    stopPercent: Math.max(0, Math.min(100, Number(parsed.stopPercent ?? 0.35))),
    timeHorizonMinutes: Math.max(1, Math.min(180, Number(parsed.timeHorizonMinutes ?? Math.ceil(Number(parsed.estimatedDurationSec ?? 420) / 60)))),
    riskReason: normalizeSchemaText(parsed.riskReason, "Remote risk context unavailable", 180),
    invalidationReason: normalizeSchemaText(parsed.invalidationReason, "Remote invalidation context unavailable", 180),
    estimatedDurationSec: Math.max(30, Math.min(10800, Number(parsed.estimatedDurationSec ?? 420))),
    reasoningShort: normalizeSchemaText(parsed.reasoningShort, `${providerName}: remote model analysis`, 160),
  });
  if (!schemaResult.success) return null;
  const confidence = clampScore(typeof parsed.confidence === "number" ? parsed.confidence : 0);
  const riskScore = clampScore(typeof parsed.riskScore === "number" ? parsed.riskScore : 70);

  const reasoningShort = String(parsed.reasoningShort ?? `${providerName}: remote model analysis`)
    .replace(/\s+/g, " ")
    .slice(0, 120);

  const output = {
    decision,
    confidence,
    riskScore,
    targetPrice:
      typeof parsed.targetPrice === "number" && Number.isFinite(parsed.targetPrice)
        ? Number(parsed.targetPrice.toFixed(8))
        : fallbackTarget,
    stopPrice:
      typeof parsed.stopPrice === "number" && Number.isFinite(parsed.stopPrice)
        ? Number(parsed.stopPrice.toFixed(8))
        : fallbackStop,
    estimatedDurationSec: Math.max(
      30,
      Math.min(
        10800,
        Number.isFinite(parsed.estimatedDurationSec ?? NaN)
          ? Number(parsed.estimatedDurationSec)
          : lane === "risk"
            ? 240
            : 420,
      ),
    ),
    reasoningShort,
    metadata: {
      remote: true,
      lane,
      provider: providerName,
      expectedMovePercent: parsed.expectedMovePercent,
      expectedMoveRange: parsed.expectedMoveRange,
      targetPercent: parsed.targetPercent,
      stopPercent: parsed.stopPercent,
      timeHorizonMinutes: parsed.timeHorizonMinutes,
      riskReason: parsed.riskReason,
      invalidationReason: parsed.invalidationReason,
    },
  } satisfies AIModelOutput;
  return normalizeAiModelOutput({
    output,
    analysisInput: input,
    minProfitPercent: Math.max(0.25, env.EXECUTION_TARGET_MIN_PROFIT_PERCENT),
    maxDurationSec: lane === "risk" ? 900 : lane === "momentum" ? 1800 : 2400,
  });
}

export async function analyzeWithRemoteModel(
  config: AIProviderConfig,
  input: AIAnalysisInput,
  lane: AnalysisLane,
): Promise<AIModelOutput | null> {
  const provider = detectProvider(config);
  const apiKey = config.apiKey?.trim();
  if (!provider || !apiKey) return null;

  const providerKey = `${provider}:${config.id}`;
  const blockedUntil = providerBackoffUntil.get(providerKey) ?? 0;
  if (Date.now() < blockedUntil) {
    return null;
  }

  const cacheKey = `${provider}:${config.id}:${lane}:${input.symbol}:${input.lastPrice.toFixed(8)}:${input.volume24h.toFixed(2)}`;
  const cached = resultCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const running = inflight.get(cacheKey);
  if (running) return running;

  const task = (async () => {
    try {
      const prompt = buildPrompt(input, lane);
      const timeoutMs =
        provider === "openai"
          ? Math.max(9000, config.timeoutMs)
          : provider === "anthropic"
            ? Math.max(9000, config.timeoutMs)
            : Math.max(9000, config.timeoutMs);
      const raw =
        provider === "openai"
          ? await callOpenAI(apiKey, prompt, timeoutMs)
          : provider === "anthropic"
            ? await callAnthropic(apiKey, prompt, timeoutMs)
            : await callGemini(apiKey, prompt, timeoutMs);

      const output = toOutput(parseLenientModelOutput(raw), input, lane, config.name);
      if (!output) {
        throw new Error("Remote response is not valid JSON output");
      }
      output.metadata = {
        ...output.metadata,
        remoteOk: true,
        degraded: false,
        failureCategory: null,
        model: config.model ?? null,
      };
      resultCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value: output });
      providerBackoffUntil.delete(providerKey);
      return output;
    } catch (error) {
      const message = (error as Error).message;
      if (isTransientRemoteFailure(message)) {
        providerBackoffUntil.set(providerKey, Date.now() + 1_500);
      }
      if (shouldWarn(`${providerKey}:${lane}`, 12_000)) {
        const failureCategory = classifyRemoteAiFailure(message);
        logger.warn(
          {
            providerId: config.id,
            providerName: config.name,
            lane,
            symbol: input.symbol,
            failureCategory,
            remote: false,
            error: message,
          },
          "Remote AI call failed; provider degraded",
        );
      }
      return null;
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, task);
  return task;
}
