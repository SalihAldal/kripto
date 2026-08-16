export type FilterPriority = "CRITICAL" | "IMPORTANT" | "ADVISORY";

export type ClassifiedFilterHit = {
  reason: string;
  priority: FilterPriority;
  bucket?: string;
};

export type AdaptiveRelaxation = {
  tier: number;
  minConfidenceDelta: number;
  minQualityScoreDelta: number;
  minScannerScoreDelta: number;
  minScannerConfidenceDelta: number;
  compositeFloorRelax: number;
  advisoryStackLimit: number;
  explorationMode: boolean;
};

export type EntryDecisionExplanation = {
  ok: boolean;
  primaryBlocker: string | null;
  secondaryBlockers: string[];
  criticalBlockers: string[];
  importantBlockers: string[];
  advisoryBlockers: string[];
  waivedBlockers: string[];
  wouldPassWithRelaxedThresholds: boolean;
  relaxation: AdaptiveRelaxation;
  effectiveConfidenceFloor: number;
  effectiveQualityFloor: number;
  compositeAvg: number;
  advisoryStackCount: number;
};
