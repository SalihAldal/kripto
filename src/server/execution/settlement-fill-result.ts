export type SettlementFillStatus =
  | "APPLIED"
  | "ALREADY_APPLIED"
  | "FAILED"
  | "PENDING"
  | "UNKNOWN";

export type SettlementFillResult = {
  status: SettlementFillStatus;
  positionId: string;
  settlementFillId: string;
  tradeOrderId?: string;
  executionRef?: string;
  executedQuantity: number | null;
  fillPrice: number | null;
  fillFee: number | null;
  feeAsset: "BASE" | "QUOTE" | "UNKNOWN" | null;
  orderTerminal: boolean;
  orderRemainingQuantity: number;
  positionRemainingQuantity: number | null;
  positionClosed: boolean;
  partial: boolean;
  reason?: string;
};

export function isSuccessfulSettlementFill(result: SettlementFillResult) {
  return result.status === "APPLIED" || result.status === "ALREADY_APPLIED";
}

export function requireSettlementFillEvidence(result: SettlementFillResult) {
  if (!isSuccessfulSettlementFill(result)) return null;
  if (result.executedQuantity == null || result.executedQuantity <= 0) return null;
  if (result.fillPrice == null || !Number.isFinite(result.fillPrice)) return null;
  if (result.fillFee == null || !Number.isFinite(result.fillFee)) return null;
  if (!result.feeAsset) return null;
  return {
    executedQuantity: result.executedQuantity,
    fillPrice: result.fillPrice,
    fillFee: result.fillFee,
    feeAsset: result.feeAsset,
  };
}
