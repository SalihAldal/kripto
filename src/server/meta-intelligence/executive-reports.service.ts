import { persistExecutiveReport, persistExecutiveRecommendation } from "@/src/server/meta-intelligence/meta-intelligence.repository";
import { buildGlobalContext } from "@/src/server/meta-intelligence/global-context.service";
import { generateExecutiveReasoning } from "@/src/server/meta-intelligence/executive-reasoning.service";
import { buildMarketNarrative } from "@/src/server/meta-intelligence/narrative-builder.service";
import { trackExecutiveKpis } from "@/src/server/meta-intelligence/executive-kpi.service";
import { emitMetaEvent, META_EVENT } from "@/src/server/meta-intelligence/meta-intelligence.events";
import type { ExecutiveReportType } from "@prisma/client";

const REPORT_TITLES: Record<ExecutiveReportType, string> = {
  MORNING_BRIEFING: "Morning Executive Briefing",
  MIDDAY_BRIEFING: "Midday Executive Briefing",
  EVENING_BRIEFING: "Evening Executive Briefing",
  DAILY_EXECUTIVE: "Daily Executive Report",
  WEEKLY_CIO: "Weekly CIO Report",
  MONTHLY_IC: "Monthly Investment Committee Report",
};

export async function generateExecutiveReport(reportType: ExecutiveReportType = "DAILY_EXECUTIVE") {
  await buildGlobalContext();
  const { summary, recommendation, reasoning } = await generateExecutiveReasoning();
  const { narrative, regime } = await buildMarketNarrative(3);
  const kpis = await trackExecutiveKpis();

  const content = [
    `# ${REPORT_TITLES[reportType]}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Executive Summary",
    summary.executiveSummary,
    "",
    "## Reasoning",
    reasoning,
    "",
    "## Market Narrative",
    `${narrative.title}: ${narrative.story}`,
    `Regime: ${regime}`,
    "",
    "## Platform KPIs",
    `Overall Executive Score: ${kpis.overallExecutiveScore}`,
    "",
    "---",
    "This report is intelligence-only. No production systems were modified.",
  ].join("\n");

  const report = await persistExecutiveReport({
    reportType,
    title: REPORT_TITLES[reportType],
    content,
    highlights: [recommendation, `Regime: ${regime}`, `Confidence: ${summary.keyInsights[1] ?? "N/A"}`],
    risks: ["Conflicting intelligence signals", "Elevated whale activity", "Engineering debt accumulation"].slice(0, 3),
    opportunities: ["Aligned bullish intelligence", "On-chain protocol health improving", "Learning velocity increasing"].slice(0, 3),
    kpis: kpis as unknown as Record<string, unknown>,
  });

  emitMetaEvent(META_EVENT.REPORT_GENERATED, { reportId: report.id, reportType });
  return report;
}

export async function generateRecommendations(limit = 10) {
  const recs = [];
  const templates = [
    { category: "RISK", title: "Review risk exposure limits", modules: ["risk-engine"], priority: "HIGH" as const },
    { category: "SCANNER", title: "Evaluate scanner signal quality", modules: ["scanner"], priority: "MEDIUM" as const },
    { category: "RESEARCH", title: "Prioritize quant research on top narratives", modules: ["quant-research"], priority: "MEDIUM" as const },
    { category: "LEARNING", title: "Accelerate learning on recent decision outcomes", modules: ["learning-engine"], priority: "HIGH" as const },
    { category: "ARCHITECTURE", title: "Address engineering technical debt", modules: ["engineering-intelligence"], priority: "MEDIUM" as const },
  ];

  for (const t of templates.slice(0, limit)) {
    const row = await persistExecutiveRecommendation({
      category: t.category,
      title: t.title,
      description: `Executive recommendation for ${t.modules.join(", ")} — no automatic modifications`,
      confidence: 65,
      expectedBenefit: "Improved subsystem performance",
      expectedRisk: "None — recommendation only",
      implementationCost: "Team review required",
      priority: t.priority,
      affectedModules: t.modules,
    });
    recs.push(row);
  }
  emitMetaEvent(META_EVENT.RECOMMENDATION_CREATED, { count: recs.length });
  return { recommendations: recs };
}
