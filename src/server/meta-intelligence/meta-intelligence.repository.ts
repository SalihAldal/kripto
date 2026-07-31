import { createHash } from "node:crypto";
import { prisma } from "@/src/server/db/prisma";
import type { Prisma } from "@prisma/client";
import type { ConfidenceScores, GlobalMarketContext } from "@/src/server/meta-intelligence/meta-intelligence.types";

function key(prefix: string) {
  return `${prefix}_${createHash("sha256").update(`${prefix}_${Date.now()}`).digest("hex").slice(0, 16)}`;
}

export async function persistMetaContext(input: GlobalMarketContext & { fusedGraph?: Record<string, unknown>; confidence?: Partial<ConfidenceScores> }) {
  const contextKey = key("ctx");
  return prisma.metaContext.create({
    data: {
      contextKey,
      marketRegime: input.marketRegime,
      scannerSnapshot: input.scanner as Prisma.InputJsonValue,
      newsSnapshot: input.news as Prisma.InputJsonValue,
      whaleSnapshot: input.whale as Prisma.InputJsonValue,
      onChainSnapshot: input.onChain as Prisma.InputJsonValue,
      portfolioSnapshot: input.portfolio as Prisma.InputJsonValue,
      riskSnapshot: input.risk as Prisma.InputJsonValue,
      learningSnapshot: input.learning as Prisma.InputJsonValue,
      researchSnapshot: input.research as Prisma.InputJsonValue,
      governanceSnapshot: input.governance as Prisma.InputJsonValue,
      engineeringSnapshot: input.engineering as Prisma.InputJsonValue,
      fusedGraph: input.fusedGraph as Prisma.InputJsonValue,
      overallConfidence: input.confidence?.overallConfidence ?? 50,
      dataConfidence: input.confidence?.dataConfidence ?? 50,
    },
  });
}

export async function updateMetaContextFusion(contextId: string, fusedGraph: Record<string, unknown>, confidence: Partial<ConfidenceScores>) {
  return prisma.metaContext.update({
    where: { id: contextId },
    data: {
      fusedGraph: fusedGraph as Prisma.InputJsonValue,
      overallConfidence: confidence.overallConfidence,
      dataConfidence: confidence.dataConfidence,
    },
  });
}

export async function persistExecutiveDecision(input: {
  contextId?: string;
  recommendation: string;
  conflictSummary?: string;
  resolution: string;
  confidence: ConfidenceScores;
  supportingEvidence?: Record<string, unknown>;
  historicalSimilarity?: number;
  expectedBenefit?: string;
  expectedRisk?: string;
  implementationCost?: string;
  priority?: Parameters<typeof prisma.executiveDecision.create>[0]["data"]["priority"];
}) {
  return prisma.executiveDecision.create({
    data: {
      contextId: input.contextId,
      decisionKey: key("dec"),
      recommendation: input.recommendation,
      conflictSummary: input.conflictSummary,
      resolution: input.resolution,
      ...input.confidence,
      supportingEvidence: input.supportingEvidence as Prisma.InputJsonValue,
      historicalSimilarity: input.historicalSimilarity,
      expectedBenefit: input.expectedBenefit,
      expectedRisk: input.expectedRisk,
      implementationCost: input.implementationCost,
      priority: input.priority ?? "MEDIUM",
    },
  });
}

export async function persistExecutiveSummary(input: {
  contextId?: string;
  summaryType: string;
  title: string;
  executiveSummary: string;
  reasoning: string;
  whyNotWhat?: string;
  keyInsights?: string[];
}) {
  return prisma.executiveSummary.create({ data: input });
}

export async function upsertMarketNarrative(input: {
  narrativeKey: string;
  narrativeType: Parameters<typeof prisma.marketNarrative.create>[0]["data"]["narrativeType"];
  title: string;
  story: string;
  marketRegime: Parameters<typeof prisma.marketNarrative.create>[0]["data"]["marketRegime"];
  heatScore: number;
  confidence: number;
  supportingSignals?: Record<string, unknown>;
}) {
  return prisma.marketNarrative.upsert({
    where: { narrativeKey: input.narrativeKey },
    create: { ...input, supportingSignals: input.supportingSignals as Prisma.InputJsonValue },
    update: { title: input.title, story: input.story, heatScore: input.heatScore, confidence: input.confidence, supportingSignals: input.supportingSignals as Prisma.InputJsonValue },
  });
}

export async function persistExecutiveRecommendation(input: {
  category: string;
  title: string;
  description: string;
  supportingEvidence?: Record<string, unknown>;
  confidence?: number;
  historicalSimilarity?: number;
  expectedBenefit?: string;
  expectedRisk?: string;
  implementationCost?: string;
  priority?: Parameters<typeof prisma.executiveRecommendation.create>[0]["data"]["priority"];
  affectedModules?: string[];
}) {
  return prisma.executiveRecommendation.create({
    data: {
      category: input.category,
      title: input.title,
      description: input.description,
      supportingEvidence: input.supportingEvidence as Prisma.InputJsonValue,
      confidence: input.confidence ?? 50,
      historicalSimilarity: input.historicalSimilarity,
      expectedBenefit: input.expectedBenefit,
      expectedRisk: input.expectedRisk,
      implementationCost: input.implementationCost,
      priority: input.priority ?? "MEDIUM",
      affectedModules: input.affectedModules ?? [],
    },
  });
}

export async function persistCommitteeMeeting(input: {
  topic: string;
  opinions: Record<string, unknown>;
  consensus?: string;
  dissent?: Record<string, unknown>;
  metaSummary: string;
  overallConfidence?: number;
}) {
  return prisma.committeeMeeting.create({
    data: { meetingKey: key("mtg"), ...input, opinions: input.opinions as Prisma.InputJsonValue, dissent: input.dissent as Prisma.InputJsonValue },
  });
}

export async function upsertStrategicObjective(input: {
  objectiveType: Parameters<typeof prisma.strategicObjective.create>[0]["data"]["objectiveType"];
  name: string;
  description?: string;
  targetScore?: number;
  currentScore?: number;
}) {
  const existing = await prisma.strategicObjective.findFirst({ where: { objectiveType: input.objectiveType, isActive: true } });
  if (existing) {
    return prisma.strategicObjective.update({
      where: { id: existing.id },
      data: { currentScore: input.currentScore, progressPct: ((input.currentScore ?? 50) / (input.targetScore ?? 80)) * 100 },
    });
  }
  return prisma.strategicObjective.create({ data: input });
}

export async function persistExecutiveMemory(input: {
  memoryKey: string;
  memoryType: string;
  title: string;
  description: string;
  impact?: string;
  lessonLearned?: string;
  marketRegime?: Parameters<typeof prisma.executiveMemory.create>[0]["data"]["marketRegime"];
  tags?: string[];
  confidence?: number;
}) {
  return prisma.executiveMemory.upsert({
    where: { memoryKey: input.memoryKey },
    create: input,
    update: { description: input.description, lessonLearned: input.lessonLearned },
  });
}

export async function upsertMetaKnowledge(input: {
  nodeKey: string;
  nodeType: string;
  label: string;
  relations?: Record<string, unknown>;
  weight?: number;
}) {
  return prisma.metaKnowledge.upsert({
    where: { nodeKey: input.nodeKey },
    create: { ...input, relations: input.relations as Prisma.InputJsonValue },
    update: { label: input.label, relations: input.relations as Prisma.InputJsonValue, weight: input.weight },
  });
}

export async function persistExecutiveReport(input: {
  reportType: Parameters<typeof prisma.executiveReport.create>[0]["data"]["reportType"];
  title: string;
  content: string;
  highlights?: string[];
  risks?: string[];
  opportunities?: string[];
  kpis?: Record<string, unknown>;
}) {
  return prisma.executiveReport.create({
    data: { reportKey: key("rpt"), ...input, kpis: input.kpis as Prisma.InputJsonValue },
  });
}

export async function persistExecutiveKpi(input: {
  platformHealth: number;
  tradingHealth: number;
  learningVelocity: number;
  researchVelocity: number;
  systemStability: number;
  decisionAccuracy: number;
  engineeringHealth: number;
  riskExposure: number;
  portfolioHealth: number;
  marketIntelligenceQuality: number;
  overallExecutiveScore: number;
}) {
  return prisma.executiveKpi.create({ data: { snapshotKey: key("kpi"), ...input } });
}

export async function getExecutiveDashboard() {
  const [context, decisions, narratives, recommendations, meetings, objectives, memory, reports, kpis, knowledge] = await Promise.all([
    prisma.metaContext.findFirst({ orderBy: { builtAt: "desc" }, include: { decisions: { take: 5 }, summaries: { take: 3 } } }),
    prisma.executiveDecision.findMany({ orderBy: { decidedAt: "desc" }, take: 20 }),
    prisma.marketNarrative.findMany({ where: { active: true }, orderBy: { heatScore: "desc" }, take: 15 }),
    prisma.executiveRecommendation.findMany({ where: { status: "OPEN" }, orderBy: { priority: "asc" }, take: 20 }),
    prisma.committeeMeeting.findMany({ orderBy: { heldAt: "desc" }, take: 10 }),
    prisma.strategicObjective.findMany({ where: { isActive: true } }),
    prisma.executiveMemory.findMany({ orderBy: { recordedAt: "desc" }, take: 20 }),
    prisma.executiveReport.findMany({ orderBy: { generatedAt: "desc" }, take: 10 }),
    prisma.executiveKpi.findMany({ orderBy: { recordedAt: "desc" }, take: 10 }),
    prisma.metaKnowledge.findMany({ orderBy: { weight: "desc" }, take: 50 }),
  ]);
  return { context, decisions, narratives, recommendations, meetings, objectives, memory, reports, kpis, knowledge };
}

export async function getLatestContext() {
  return prisma.metaContext.findFirst({ orderBy: { builtAt: "desc" } });
}

export async function listExecutiveReports(reportType?: string, limit = 20) {
  return prisma.executiveReport.findMany({
    where: reportType ? { reportType: reportType as never } : undefined,
    orderBy: { generatedAt: "desc" },
    take: limit,
  });
}

export async function listStrategicPriorities(limit = 30) {
  const [decisions, recommendations, narratives] = await Promise.all([
    prisma.executiveDecision.findMany({ orderBy: { priority: "asc" }, take: limit }),
    prisma.executiveRecommendation.findMany({ where: { status: "OPEN" }, orderBy: { priority: "asc" }, take: limit }),
    prisma.marketNarrative.findMany({ where: { active: true }, orderBy: { heatScore: "desc" }, take: limit }),
  ]);
  return { decisions, recommendations, narratives };
}

export async function getKnowledgeGraph(limit = 100) {
  return prisma.metaKnowledge.findMany({ orderBy: { weight: "desc" }, take: limit });
}
