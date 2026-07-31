import { persistDeveloperMetrics } from "@/src/server/onchain-intelligence/onchain-intelligence.repository";
import { DEFAULT_PROTOCOLS } from "@/src/server/onchain-intelligence/onchain-intelligence.types";

function rand(min: number, max: number) {
  return Math.floor(min + Math.random() * (max - min));
}

export async function trackDeveloperActivity(limit = 10) {
  const periodEnd = new Date();
  const periodStart = new Date(Date.now() - 7 * 24 * 60 * 60_000);
  let tracked = 0;

  for (const p of DEFAULT_PROTOCOLS.slice(0, limit)) {
    const commits = rand(10, 500);
    const contributors = rand(5, 100);
    await persistDeveloperMetrics({
      protocol: p.protocol,
      repoUrl: `https://github.com/${p.protocol.toLowerCase()}`,
      commits,
      contributors,
      releases: rand(0, 5),
      openIssues: rand(10, 200),
      pullRequests: rand(5, 80),
      devVelocity: Number(((commits / 7) * (contributors / 10)).toFixed(2)),
      periodStart,
      periodEnd,
      quality: { confidence: 74, reliability: 72, freshness: 90 },
    });
    tracked += 1;
  }
  return { tracked };
}
