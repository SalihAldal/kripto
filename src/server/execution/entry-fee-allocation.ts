type PositionLike = {
  quantity: number;
  feeTotal?: number | null;
  metadata?: unknown;
};

export type EntryFeeAllocationState = {
  entryFeeTotal: number;
  entryQuantityInitial: number;
  entryFeeAllocated: number;
};

function asMetadataRecord(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}

function finitePositive(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

/** Authoritative entry-fee state; does not treat exit fees in position.feeTotal as entry fee. */
export function readEntryFeeAllocationState(position: PositionLike): EntryFeeAllocationState {
  const metadata = asMetadataRecord(position.metadata);
  const entryFeeTotal = finitePositive(metadata.entryFeeTotal ?? metadata.openFee ?? metadata.buyFee);
  const entryQuantityInitial = finitePositive(metadata.entryQuantityInitial ?? metadata.openQuantity);
  const entryFeeAllocated = Math.max(0, Number(metadata.entryFeeAllocated ?? 0));
  return {
    entryFeeTotal,
    entryQuantityInitial,
    entryFeeAllocated: Number.isFinite(entryFeeAllocated) ? entryFeeAllocated : 0,
  };
}

export function seedEntryFeeAllocationMetadata(input: {
  entryFeeTotal: number;
  entryQuantityInitial: number;
  metadata?: Record<string, unknown> | null;
}): Record<string, unknown> {
  const base = { ...(input.metadata ?? {}) };
  return {
    ...base,
    entryFeeTotal: Number(input.entryFeeTotal.toFixed(8)),
    entryQuantityInitial: Number(input.entryQuantityInitial.toFixed(8)),
    entryFeeAllocated: 0,
    openFee: Number(input.entryFeeTotal.toFixed(8)),
  };
}

export function allocateEntryFeePortion(input: {
  state: EntryFeeAllocationState;
  fillQuantity: number;
}): { portion: number; nextState: EntryFeeAllocationState } {
  const fillQuantity = finitePositive(input.fillQuantity);
  const { entryFeeTotal, entryQuantityInitial, entryFeeAllocated } = input.state;
  if (fillQuantity <= 0 || entryFeeTotal <= 0 || entryQuantityInitial <= 0) {
    return { portion: 0, nextState: input.state };
  }
  const remainingFee = Math.max(0, Number((entryFeeTotal - entryFeeAllocated).toFixed(8)));
  if (remainingFee <= 0) {
    return { portion: 0, nextState: input.state };
  }
  const proportional = Number((entryFeeTotal * (fillQuantity / entryQuantityInitial)).toFixed(8));
  const isFinalSlice = proportional + 1e-8 >= remainingFee;
  const portion = isFinalSlice ? remainingFee : Math.min(proportional, remainingFee);
  return {
    portion: Number(portion.toFixed(8)),
    nextState: {
      entryFeeTotal,
      entryQuantityInitial,
      entryFeeAllocated: Number((entryFeeAllocated + portion).toFixed(8)),
    },
  };
}

export function entryFeeAllocationMetadataPatch(nextState: EntryFeeAllocationState): Record<string, number> {
  return {
    entryFeeTotal: nextState.entryFeeTotal,
    entryQuantityInitial: nextState.entryQuantityInitial,
    entryFeeAllocated: nextState.entryFeeAllocated,
  };
}
