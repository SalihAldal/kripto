import { buildEntryHeatmap } from "@/src/server/entry-timing/entry-timing.repository";

export async function generateEntryHeatmap() {
  const heatmap = await buildEntryHeatmap();
  return {
    heatmap,
    byType: await import("@/src/server/entry-timing/entry-learning.service").then((m) => m.getBestAndWorstPatterns()),
  };
}
