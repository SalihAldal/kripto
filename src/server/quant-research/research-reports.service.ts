import { prisma } from "@/src/server/db/prisma";
import { persistResearchReport } from "@/src/server/quant-research/quant-research.repository";
import { researchDbOnly } from "@/src/server/quant-research/research-environment.service";
import type { ResearchReportCadence } from "@/src/server/quant-research/quant-research.types";

export async function generateResearchReport(cadence: ResearchReportCadence = "DAILY", date = new Date()) {
  return researchDbOnly(async () => {
    const { since, reportDate, title } = resolvePeriod(cadence, date);

    const [experiments, candidates, simulations, evolutions, benchmarks] = await Promise.all([
      prisma.experiment.findMany({ where: { createdAt: { gte: since } }, take: 50 }),
      prisma.strategyCandidate.findMany({ orderBy: { score: "desc" }, take: 20 }),
      prisma.simulationRun.findMany({ where: { createdAt: { gte: since } }, take: 50 }),
      prisma.strategyEvolution.findMany({ where: { createdAt: { gte: since } }, take: 50 }),
      prisma.benchmark.findMany({ where: { recordedAt: { gte: since } }, take: 30 }),
    ]);

    const content = {
      cadence,
      periodStart: since.toISOString(),
      experiments: experiments.length,
      topCandidates: candidates.slice(0, 5),
      simulations: simulations.length,
      evolutions: evolutions.filter((e) => e.survived).length,
      benchmarks: benchmarks.length,
      highlights: [
        candidates[0] ? `Top candidate: ${candidates[0].candidateKey} score=${candidates[0].score}` : null,
        evolutions.length > 0 ? `${evolutions.filter((e) => e.survived).length} strategies survived evolution` : null,
      ].filter(Boolean),
    };

    const summary = `${cadence} research: ${experiments.length} experiments, ${simulations.length} simulations`;
    await persistResearchReport({ cadence, reportDate, title, summary, content });
    return content;
  });
}

function resolvePeriod(cadence: ResearchReportCadence, date: Date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (cadence === "DAILY") {
    return { since: d, reportDate: d, title: `Daily Research Report ${d.toISOString().slice(0, 10)}` };
  }
  if (cadence === "WEEKLY") {
    const day = d.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setUTCDate(d.getUTCDate() + diff);
    const since = new Date(d.getTime() - 7 * 24 * 60 * 60_000);
    return { since, reportDate: d, title: `Weekly Research Report ${d.toISOString().slice(0, 10)}` };
  }
  const monthStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const since = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  return { since, reportDate: monthStart, title: `Monthly Research Report ${monthStart.toISOString().slice(0, 7)}` };
}
