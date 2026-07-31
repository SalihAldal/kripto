import { prisma } from "@/src/server/db/prisma";
import { persistResearchKnowledge } from "@/src/server/quant-research/quant-research.repository";
import { researchDbOnly } from "@/src/server/quant-research/research-environment.service";
import { emitQuantResearchEvent, QUANT_RESEARCH_EVENT } from "@/src/server/quant-research/quant-research.events";

const DISCOVERY_QUESTIONS = [
  "Can this strategy be improved with fewer indicators?",
  "Can fewer indicators perform better than the current set?",
  "Can AI explain why this strategy works in bull regimes but fails in range?",
  "Can another model architecture outperform the current genome?",
  "Can a completely different strategy archetype win in the next 90 days?",
  "Is momentum or mean-reversion better suited for current market structure?",
  "Would hybrid multi-timeframe reduce false signals?",
  "Can parameter optimization unlock hidden edge without overfitting?",
];

export async function runSelfDiscovery() {
  return researchDbOnly(async () => {
    const topCandidate = await prisma.strategyCandidate.findFirst({ orderBy: { score: "desc" }, include: { genome: true } });
    const questions = DISCOVERY_QUESTIONS.map((q) => ({
      question: q,
      context: topCandidate
        ? { strategy: topCandidate.genome.name, score: topCandidate.score, archetype: topCandidate.genome.archetype }
        : { strategy: "none" },
      priority: Math.random(),
    }));
    questions.sort((a, b) => b.priority - a.priority);

    const nextActions = [
      { action: "STRATEGY_EVOLVE", reason: "Test next generation mutations" },
      { action: "PARAMETER_OPTIMIZE", reason: "Sweep thresholds on top genome" },
      { action: "STRATEGY_COMPETITION", reason: "Re-rank against production baseline" },
      { action: "FEATURE_SELECT", reason: "Identify harmful indicators" },
    ];

    for (const q of questions.slice(0, 3)) {
      emitQuantResearchEvent(QUANT_RESEARCH_EVENT.SELF_DISCOVERY, q);
      await persistResearchKnowledge({
        category: "SELF_DISCOVERY",
        title: q.question,
        content: JSON.stringify(q.context),
        tags: ["self-discovery", "research-question"],
      }).catch(() => null);
    }

    return { questions: questions.slice(0, 5), nextActions };
  });
}
