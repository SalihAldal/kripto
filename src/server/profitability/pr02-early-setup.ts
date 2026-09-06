import {
  PR02_POLICY_VERSION,
  type EarlySetupState,
  type EarlySetupTransition,
} from "@/src/server/profitability/pr02-types";

export const EARLY_SETUP_ARM_MS = 120_000;
export const EARLY_SETUP_EXPIRE_MS = 180_000;
export const EARLY_TRIGGER_VALID_MS = 45_000;
export const EARLY_REARM_COOLDOWN_MS = 60_000;

type SetupRecord = {
  candidateId: string;
  lifecycleId: string;
  state: EarlySetupState;
  triggerGeneration: number;
  lastSignalId: string | null;
  lastTriggerAtMs: number | null;
  armedAtMs: number | null;
  invalidatedAtMs: number | null;
  expiredAtMs: number | null;
  snapshotReference: string | null;
};

const store = new Map<string, SetupRecord>();

function key(candidateId: string, lifecycleId: string) {
  return `${candidateId}:${lifecycleId}`;
}

export function resetEarlySetupStoreForTests() {
  store.clear();
}

export function getEarlySetupState(candidateId: string, lifecycleId: string): EarlySetupState {
  return store.get(key(candidateId, lifecycleId))?.state ?? "WARMUP";
}

export function processEarlySetupTransition(input: {
  candidateId: string;
  lifecycleId: string;
  eventAtMs: number;
  availableAtMs: number;
  snapshotReference: string | null;
  warmupComplete: boolean;
  setupQualified: boolean;
  triggerFired: boolean;
  invalidated: boolean;
  expired: boolean;
  signalId: string | null;
}): EarlySetupTransition {
  const id = key(input.candidateId, input.lifecycleId);
  const existing = store.get(id) ?? {
    candidateId: input.candidateId,
    lifecycleId: input.lifecycleId,
    state: "WARMUP" as EarlySetupState,
    triggerGeneration: 0,
    lastSignalId: null,
    lastTriggerAtMs: null,
    armedAtMs: null,
    invalidatedAtMs: null,
    expiredAtMs: null,
    snapshotReference: null,
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
    existing.invalidatedAtMs = input.eventAtMs;
    existing.armedAtMs = null;
  } else if (input.expired) {
    newState = "EXPIRED";
    reasonCode = "SETUP_EXPIRED";
    existing.expiredAtMs = input.eventAtMs;
    existing.armedAtMs = null;
  } else if (input.triggerFired && input.signalId) {
    if (existing.lastSignalId === input.signalId) {
      newState = previousState === "TRIGGERED" ? "TRIGGERED" : previousState;
      reasonCode = "DUPLICATE_SIGNAL_SUPPRESSED";
    } else if (
      previousState === "TRIGGERED" &&
      existing.lastTriggerAtMs != null &&
      input.eventAtMs - existing.lastTriggerAtMs < EARLY_REARM_COOLDOWN_MS
    ) {
      newState = "TRIGGERED";
      reasonCode = "REARM_COOLDOWN_ACTIVE";
    } else {
      newState = "TRIGGERED";
      triggerGeneration += 1;
      lastSignalId = input.signalId;
      lastTriggerAtMs = input.eventAtMs;
      reasonCode = "ENTRY_TRIGGER_FIRED";
    }
  } else if (previousState === "WARMUP") {
    newState = "OBSERVING";
    reasonCode = "WARMUP_COMPLETE";
  } else if (input.setupQualified) {
    newState = "ARMED";
    if (!existing.armedAtMs) existing.armedAtMs = input.eventAtMs;
    reasonCode =
      previousState === "TRIGGERED" || previousState === "ARMED"
        ? "REARM_SETUP_QUALIFIED"
        : "SETUP_ARMED";
  } else if (previousState === "ARMED" || previousState === "TRIGGERED") {
    newState = "OBSERVING";
    reasonCode = "SETUP_CONDITIONS_LOST";
    existing.armedAtMs = null;
  } else {
    newState = "OBSERVING";
    reasonCode = "OBSERVING";
  }

  if (
    newState !== "INVALIDATED" &&
    newState !== "EXPIRED" &&
    newState !== "TRIGGERED" &&
    existing.armedAtMs != null &&
    input.eventAtMs - existing.armedAtMs > EARLY_SETUP_EXPIRE_MS
  ) {
    newState = "EXPIRED";
    reasonCode = "SETUP_EXPIRED";
    existing.expiredAtMs = input.eventAtMs;
    existing.armedAtMs = null;
  }

  const record: SetupRecord = {
    ...existing,
    state: newState,
    triggerGeneration,
    lastSignalId,
    lastTriggerAtMs,
    snapshotReference: input.snapshotReference,
  };
  store.set(id, record);

  return {
    candidateId: input.candidateId,
    lifecycleId: input.lifecycleId,
    strategyId: "EARLY_ACCELERATION",
    policyVersion: PR02_POLICY_VERSION,
    eventAt: new Date(input.eventAtMs).toISOString(),
    availableAt: new Date(input.availableAtMs).toISOString(),
    previousState,
    newState,
    reasonCode,
    snapshotReference: input.snapshotReference,
    signalId: input.signalId,
    triggerGeneration,
  };
}

export function shouldSuppressDuplicateTrigger(candidateId: string, lifecycleId: string, signalId: string): boolean {
  const row = store.get(key(candidateId, lifecycleId));
  return row?.lastSignalId === signalId;
}

export function restoreEarlySetupForTests(record: SetupRecord & { lifecycleId: string; candidateId: string }) {
  store.set(key(record.candidateId, record.lifecycleId), record);
}

export type { SetupRecord };
