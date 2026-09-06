import { createHash } from "node:crypto";
import {
  PR03_POLICY_VERSION,
  type MomentumSetupState,
  type StrategySetupTransition,
} from "@/src/server/profitability/pr03-types";

export const MOMENTUM_SETUP_EXPIRE_MS = 540_000;
export const MOMENTUM_TRIGGER_VALID_MS = 60_000;
export const MOMENTUM_REARM_COOLDOWN_MS = 120_000;

type MomentumRecord = {
  candidateId: string;
  lifecycleId: string;
  setupId: string;
  state: MomentumSetupState;
  impulseReferencePrice: number | null;
  impulseAtMs: number | null;
  pauseLowPrice: number | null;
  triggerGeneration: number;
  lastSignalId: string | null;
  lastTriggerAtMs: number | null;
  setupStartedAtMs: number | null;
};

const store = new Map<string, MomentumRecord>();

function key(candidateId: string, lifecycleId: string) {
  return `MOMENTUM:${candidateId}:${lifecycleId}`;
}

export function resetMomentumSetupStoreForTests() {
  store.clear();
}

export function getMomentumSetupState(candidateId: string, lifecycleId: string): MomentumSetupState {
  return store.get(key(candidateId, lifecycleId))?.state ?? "WARMUP";
}

export function buildMomentumSetupId(candidateId: string, lifecycleId: string, impulsePrice: number, impulseAtMs: number) {
  return createHash("sha256").update(`${candidateId}:${lifecycleId}:${impulsePrice}:${impulseAtMs}`).digest("hex").slice(0, 20);
}

export function processMomentumSetupTransition(input: {
  candidateId: string;
  lifecycleId: string;
  eventAtMs: number;
  availableAtMs: number;
  snapshotReference: string | null;
  warmupComplete: boolean;
  impulseConfirmed: boolean;
  pauseObserved: boolean;
  resumptionArmed: boolean;
  triggerFired: boolean;
  invalidated: boolean;
  expired: boolean;
  signalId: string | null;
  impulseReferencePrice: number | null;
  impulseAtMs: number | null;
  pauseLowPrice: number | null;
}): StrategySetupTransition<MomentumSetupState> {
  const id = key(input.candidateId, input.lifecycleId);
  const existing = store.get(id) ?? {
    candidateId: input.candidateId,
    lifecycleId: input.lifecycleId,
    setupId: `${input.candidateId}:pending`,
    state: "WARMUP" as MomentumSetupState,
    impulseReferencePrice: null,
    impulseAtMs: null,
    pauseLowPrice: null,
    triggerGeneration: 0,
    lastSignalId: null,
    lastTriggerAtMs: null,
    setupStartedAtMs: null,
  };
  const previousState = existing.state;
  let newState = previousState;
  let reasonCode = "NO_CHANGE";
  let triggerGeneration = existing.triggerGeneration;
  let lastSignalId = existing.lastSignalId;
  let lastTriggerAtMs = existing.lastTriggerAtMs;

  if (previousState === "INVALIDATED") {
    newState = "INVALIDATED";
    reasonCode = "ALREADY_INVALIDATED";
  } else if (previousState === "EXPIRED") {
    newState = "EXPIRED";
    reasonCode = "ALREADY_EXPIRED";
  } else if (!input.warmupComplete) {
    newState = "WARMUP";
    reasonCode = "WARMUP_INCOMPLETE";
  } else if (input.invalidated) {
    newState = "INVALIDATED";
    reasonCode = "SETUP_INVALIDATED";
  } else if (input.expired) {
    newState = "EXPIRED";
    reasonCode = "SETUP_EXPIRED";
  } else if (input.triggerFired && input.signalId) {
    if (existing.lastSignalId === input.signalId) {
      reasonCode = "DUPLICATE_SIGNAL_SUPPRESSED";
      newState = previousState;
    } else if (previousState === "TRIGGERED" && existing.lastTriggerAtMs != null && input.eventAtMs - existing.lastTriggerAtMs < MOMENTUM_REARM_COOLDOWN_MS) {
      reasonCode = "REARM_COOLDOWN_ACTIVE";
      newState = "TRIGGERED";
    } else {
      newState = "TRIGGERED";
      triggerGeneration += 1;
      lastSignalId = input.signalId;
      lastTriggerAtMs = input.eventAtMs;
      reasonCode = "ENTRY_TRIGGER_FIRED";
    }
  } else if (input.resumptionArmed) {
    newState = "RESUMPTION_ARMED";
    reasonCode = "RESUMPTION_ARMED";
  } else if (input.pauseObserved) {
    newState = "PAUSE_OBSERVED";
    reasonCode = "PAUSE_OBSERVED";
    existing.pauseLowPrice = input.pauseLowPrice ?? existing.pauseLowPrice;
  } else if (input.impulseConfirmed && input.impulseReferencePrice != null) {
    newState = "IMPULSE_CONFIRMED";
    if (existing.impulseReferencePrice == null) {
      existing.impulseReferencePrice = input.impulseReferencePrice;
      existing.impulseAtMs = input.impulseAtMs ?? input.eventAtMs;
      existing.setupStartedAtMs = input.eventAtMs;
      existing.setupId = buildMomentumSetupId(input.candidateId, input.lifecycleId, input.impulseReferencePrice, existing.impulseAtMs!);
      reasonCode = "IMPULSE_CONFIRMED";
    } else {
      reasonCode = "IMPULSE_FROZEN";
    }
  } else if (previousState === "WARMUP") {
    newState = "OBSERVING";
    reasonCode = "WARMUP_COMPLETE";
  }

  if (
    existing.setupStartedAtMs != null &&
    newState !== "TRIGGERED" &&
    newState !== "INVALIDATED" &&
    newState !== "EXPIRED" &&
    input.eventAtMs - existing.setupStartedAtMs > MOMENTUM_SETUP_EXPIRE_MS
  ) {
    newState = "EXPIRED";
    reasonCode = "SETUP_EXPIRED";
  }

  const record: MomentumRecord = {
    ...existing,
    state: newState,
    triggerGeneration,
    lastSignalId,
    lastTriggerAtMs,
    impulseReferencePrice: existing.impulseReferencePrice ?? input.impulseReferencePrice,
    impulseAtMs: existing.impulseAtMs ?? input.impulseAtMs,
    pauseLowPrice: existing.pauseLowPrice ?? input.pauseLowPrice,
    setupStartedAtMs: existing.setupStartedAtMs,
    setupId: existing.setupId,
  };
  store.set(id, record);

  return {
    candidateId: input.candidateId,
    lifecycleId: input.lifecycleId,
    strategyId: "MOMENTUM_CONTINUATION",
    policyVersion: PR03_POLICY_VERSION,
    eventAt: new Date(input.eventAtMs).toISOString(),
    availableAt: new Date(input.availableAtMs).toISOString(),
    previousState,
    newState,
    reasonCode,
    snapshotReference: input.snapshotReference,
    signalId: input.signalId,
    triggerGeneration,
    setupId: record.setupId,
  };
}

export function shouldSuppressMomentumDuplicate(candidateId: string, lifecycleId: string, signalId: string) {
  return store.get(key(candidateId, lifecycleId))?.lastSignalId === signalId;
}

export function getFrozenMomentumImpulse(candidateId: string, lifecycleId: string) {
  const row = store.get(key(candidateId, lifecycleId));
  return row ? { impulseReferencePrice: row.impulseReferencePrice, impulseAtMs: row.impulseAtMs } : null;
}
