import { logger } from "@/lib/logger";
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
  estimatedDurationSec?: number;
  reasoningShort?: string;
};

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
  if (direct) return direct;

  const fenced = normalized.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    const parsedFence = safeJsonParse(fenced.trim());
    if (parsedFence) return parsedFence;
  }

  for (const candidate of extractBalancedJsonCandidates(normalized)) {
    const parsedCandidate = safeJsonParse(candidate);
    if (parsedCandidate) return parsedCandidate;
  }

  const compact = normalized.replace(/\s+/g, " ");
  const decision = compact.match(/\b(BUY|SELL|HOLD|NO_TRADE)\b/i)?.[1]?.toUpperCase();
  const confidence = Number(compact.match(/confidence[^0-9\-]*([0-9]+(?:\.[0-9]+)?)/i)?.[1] ?? NaN);
  const riskScore = Number(compact.match(/risk(?:score)?[^0-9\-]*([0-9]+(?:\.[0-9]+)?)/i)?.[1] ?? NaN);
  const estimatedDurationSec = Number(
    compact.match(/estimatedDurationSec[^0-9\-]*([0-9]+(?:\.[0-9]+)?)/i)?.[1] ??
      compact.match(/duration[^0-9\-]*([0-9]+(?:\.[0-9]+)?)/i)?.[1] ??
      NaN,
  );
  const reasoningShort = compact.slice(0, 120);

  if (!decision && !Number.isFinite(confidence) && !Number.isFinite(riskScore) && !Number.isFinite(estimatedDurationSec)) {
    return null;
  }

  return {
    decision,
    confidence: Number.isFinite(confidence) ? confidence : undefined,
    riskScore: Number.isFinite(riskScore) ? riskScore : undefined,
    estimatedDurationSec: Number.isFinite(estimatedDurationSec) ? estimatedDurationSec : undefined,
    reasoningShort,
  };
}

function normalizeDecision(raw: string | undefined): AIDecision {
  const upper = (raw ?? "").trim().toUpperCase();
  if (upper === "BUY" || upper === "SELL" || upper === "HOLD" || upper === "NO_TRADE") return upper;
  return "NO_TRADE";
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
  const maxDurationHint = lane === "risk" ? 120 : lane === "momentum" ? 180 : 240;

  const technicalSpecialistMode = lane === "technical";
  const sentimentSpecialistMode = lane === "momentum";
  const riskSpecialistMode = lane === "risk";
  return [
    technicalSpecialistMode
      ? "You are an elite TECHNICAL ANALYSIS specialist. Focus ONLY on technical structure."
      : sentimentSpecialistMode
        ? "You are an elite MARKET CONTEXT + NEWS + MOMENTUM specialist. Focus on sentiment quality only."
        : riskSpecialistMode
          ? "You are an elite RISK MANAGER and VETO ENGINE. Default behavior is protective."
          : "You are a strict short-horizon crypto analyst.",
    `Analysis profile=${analysisProfile} mode=${analystMode}`,
    "Return ONLY compact JSON with keys:",
    "decision, confidence, riskScore, targetPrice, stopPrice, estimatedDurationSec, reasoningShort",
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
        model: "gpt-4o-mini",
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
            max_tokens: 260,
            messages: [{ role: "user", content: prompt }],
          }),
        },
        timeoutMs,
      ) as { content?: Array<{ type?: string; text?: string }> };
      return json.content?.find((x) => x.type === "text")?.text ?? "";
    } catch (error) {
      lastError = error;
      const message = String((error as Error).message ?? "");
      if (message.includes("404") || isTransientRemoteFailure(message)) continue;
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
      const json = await postJson(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 300,
              responseMimeType: "application/json",
            },
            contents: [{ parts: [{ text: prompt }] }],
          }),
        },
        timeoutMs,
      ) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
      };
      const candidateTexts = (json.candidates ?? [])
        .flatMap((candidate) => candidate.content?.parts ?? [])
        .map((part) => String(part.text ?? "").trim())
        .filter(Boolean);
      return candidateTexts.join("\n");
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
    "claude-3-7-sonnet-latest",
    "claude-sonnet-4-0",
    "claude-3-5-sonnet-latest",
    "claude-3-5-haiku-latest",
    "claude-3-haiku-20240307",
    "claude-3-sonnet-20240229",
    "claude-3-5-sonnet-20240620",
  ];
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
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash-latest",
    "gemini-1.5-pro-latest",
  ];
  try {
    const json = await getJson(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
      { method: "GET" },
      timeoutMs,
    ) as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> };
    const available = (json.models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m) => String(m.name ?? "").replace(/^models\//, "").trim())
      .filter(Boolean);
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
  const confidence = clampScore(typeof parsed.confidence === "number" ? parsed.confidence : 0);
  const riskScore = clampScore(typeof parsed.riskScore === "number" ? parsed.riskScore : 70);
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

  const reasoningShort = String(parsed.reasoningShort ?? `${providerName}: remote model analysis`)
    .replace(/\s+/g, " ")
    .slice(0, 120);

  return {
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
        1200,
        Number.isFinite(parsed.estimatedDurationSec ?? NaN) ? Number(parsed.estimatedDurationSec) : lane === "risk" ? 150 : 210,
      ),
    ),
    reasoningShort,
    metadata: {
      remote: true,
      lane,
      provider: providerName,
    },
  };
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
      resultCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value: output });
      providerBackoffUntil.delete(providerKey);
      return output;
    } catch (error) {
      const message = (error as Error).message;
      if (isTransientRemoteFailure(message)) {
        providerBackoffUntil.set(providerKey, Date.now() + 1_500);
      }
      if (shouldWarn(`${providerKey}:${lane}`, 12_000)) {
        logger.warn(
          {
            providerId: config.id,
            providerName: config.name,
            lane,
            symbol: input.symbol,
            error: message,
          },
          "Remote AI call failed",
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
