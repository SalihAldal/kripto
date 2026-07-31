import type { ExecutionOrderType } from "@/src/server/execution-engine-v2/execution-engine-v2.types";

export function selectSafestOrderType(input: {
  spreadPercent: number;
  liquidityScore: number;
  urgency: "normal" | "high" | "emergency";
  side: "BUY" | "SELL";
}): ExecutionOrderType {
  if (input.urgency === "emergency") return "MARKET";
  if (input.spreadPercent > 0.25 || input.liquidityScore < 35) return "LIMIT";
  if (input.urgency === "high" && input.spreadPercent <= 0.12) return "IOC";
  if (input.spreadPercent <= 0.08 && input.liquidityScore >= 70) return "FOK";
  if (input.spreadPercent <= 0.15) return "IOC";
  return "MARKET";
}
