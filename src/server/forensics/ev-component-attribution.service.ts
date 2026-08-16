import { createHash } from "node:crypto";
import type { EvAudit, EvComponentAttributionReport, EvComponentContribution } from "@/src/server/forensics/forensic.types";

function deterministicHash(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

function round(value: number, digits = 4) {
  return Number(value.toFixed(digits));
}

function evidenceQuality(sampleSize: number): EvComponentContribution["evidenceQuality"] {
  if (sampleSize >= 20) return "HIGH";
  if (sampleSize >= 10) return "MEDIUM";
  if (sampleSize >= 3) return "LOW";
  return "INSUFFICIENT";
}

export function buildEvComponentAttributionReport(input: { evAudits: EvAudit[] }): EvComponentAttributionReport {
  const audits = input.evAudits.filter((row) => Number.isFinite(row.expectedValue));
  const sampleSize = audits.length;

  const sums = {
    expectedProfit: 0,
    expectedLoss: 0,
    fees: 0,
    winProbability: 0,
    expectedRiskReward: 0,
  };
  const mins = { ...sums };
  const maxs = { ...sums };

  for (const audit of audits) {
    const profit = Number(audit.expectedProfit ?? 0);
    const loss = Number(audit.expectedLoss ?? 0);
    const fees = Number(audit.fees ?? 0);
    const winProb = Number(audit.winProbability ?? 0);
    const rr = Number(audit.expectedRiskReward ?? 0);
    sums.expectedProfit += profit;
    sums.expectedLoss += loss;
    sums.fees += fees;
    sums.winProbability += winProb;
    sums.expectedRiskReward += rr;
    mins.expectedProfit = Math.min(mins.expectedProfit, profit);
    mins.expectedLoss = Math.min(mins.expectedLoss, loss);
    mins.fees = Math.min(mins.fees, fees);
    mins.winProbability = Math.min(mins.winProbability, winProb);
    mins.expectedRiskReward = Math.min(mins.expectedRiskReward, rr);
    maxs.expectedProfit = Math.max(maxs.expectedProfit, profit);
    maxs.expectedLoss = Math.max(maxs.expectedLoss, loss);
    maxs.fees = Math.max(maxs.fees, fees);
    maxs.winProbability = Math.max(maxs.winProbability, winProb);
    maxs.expectedRiskReward = Math.max(maxs.expectedRiskReward, rr);
  }

  const avgEv = sampleSize > 0 ? audits.reduce((acc, row) => acc + Number(row.expectedValue ?? 0), 0) / sampleSize : 0;
  const components: EvComponentContribution[] = [
    {
      component: "expectedProfit",
      weight: 0.35,
      range: { min: round(mins.expectedProfit), max: round(maxs.expectedProfit) },
      observedContribution: sampleSize > 0 ? round(sums.expectedProfit / sampleSize) : 0,
      evidenceQuality: evidenceQuality(sampleSize),
      reasonDetail: "Positive return component from hybrid EV formula",
    },
    {
      component: "expectedLoss",
      weight: 0.25,
      range: { min: round(mins.expectedLoss), max: round(maxs.expectedLoss) },
      observedContribution: sampleSize > 0 ? round(-sums.expectedLoss / sampleSize) : 0,
      evidenceQuality: evidenceQuality(sampleSize),
      reasonDetail: "Downside penalty component",
    },
    {
      component: "fees",
      weight: 0.15,
      range: { min: round(mins.fees), max: round(maxs.fees) },
      observedContribution: sampleSize > 0 ? round(-sums.fees / sampleSize) : 0,
      evidenceQuality: evidenceQuality(sampleSize),
      reasonDetail: "Round-trip fee drag embedded in EV",
    },
    {
      component: "winProbability",
      weight: 0.15,
      range: { min: round(mins.winProbability), max: round(maxs.winProbability) },
      observedContribution: sampleSize > 0 ? round(sums.winProbability / sampleSize) : 0,
      evidenceQuality: evidenceQuality(sampleSize),
      reasonDetail: "Probability weight applied to expected return",
    },
    {
      component: "expectedRiskReward",
      weight: 0.1,
      range: { min: round(mins.expectedRiskReward), max: round(maxs.expectedRiskReward) },
      observedContribution: sampleSize > 0 ? round(sums.expectedRiskReward / sampleSize) : 0,
      evidenceQuality: evidenceQuality(sampleSize),
      reasonDetail: "Risk/reward ratio modifier",
    },
  ];

  const dominant = [...components].sort(
    (a, b) => Math.abs(b.observedContribution) - Math.abs(a.observedContribution),
  )[0]?.component;

  const report: EvComponentAttributionReport = {
    generatedAt: new Date().toISOString(),
    formulaVersion: audits[0]?.formulaVersion ?? "hybrid-v1",
    sampleSize,
    components,
    dominantComponent: dominant,
    deterministicHash: "",
  };
  report.deterministicHash = deterministicHash({
    formulaVersion: report.formulaVersion,
    sampleSize,
    components,
    avgEv: round(avgEv),
  });
  return report;
}
