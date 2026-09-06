import { createHash } from "node:crypto";
import {
  PR03_POLICY_VERSION,
  type BreakoutSetupState,
  type StrategySetupTransition,
} from "@/src/server/profitability/pr03-types";

export const BREAKOUT_SETUP_EXPIRE_MS = 600_000;
export const BREAKOUT_TRIGGER_VALID_MS = 60_000;
export const BREAKOUT_REARM_COOLDOWN_MS = 120_000;

type BreakoutRecord = {
  candidateId: string;
  lifecycleId: string;
  setupId: string;
  state: BreakoutSetupState;
  frozenLevel: number | null;
  frozenLevelVersion: string | null;
  breakoutAtMs: number | null;
  retestAtMs: number | null;
  triggerGeneration: number;
  lastSignalId: string | null;
  lastTriggerAtMs: number | null;
  setupStartedAtMs: number | null;
};

const store = new Map<string, BreakoutRecord>();

function key(candidateId: string, lifecycleId: string) {
  return `BREAKOUT:${candidateId}:${lifecycleId}`;
}

export function resetBreakoutSetupStoreForTests() {
  store.clear();
}

export function getBreakoutSetupState(candidateId: string, lifecycleId: string): BreakoutSetupState {
  return store.get(key(candidateId, lifecycleId))?.state ?? "WARMUP";
}

export function buildSetupId(candidateId: string, lifecycleId: string, levelVersion: string, level: number) {
  return createHash("sha256").update(`${candidateId}:${lifecycleId}:${levelVersion}:${level}`).digest("hex").slice(0, 20);
}

export function processBreakoutSetupTransition(input: {
  candidateId: string;
  lifecycleId: string;
  eventAtMs: number;
  availableAtMs: number;
  snapshotReference: string | null;
  warmupComplete: boolean;
  levelReady: boolean;
  frozenLevel: number | null;
  frozenLevelVersion: string | null;
  breakoutConfirmed: boolean;
  retestPending: boolean;
  retestObserved: boolean;
  holdConfirmed: boolean;
  triggerFired: boolean;
  invalidated: boolean;
  expired: boolean;
  signalId: string | null;
  breakoutAtMs: number | null;
  retestAtMs: number | null;
}): StrategySetupTransition<BreakoutSetupState> {
  const id = key(input.candidateId, input.lifecycleId);
  const existing = store.get(id) ?? {
    candidateId: input.candidateId,
    lifecycleId: input.lifecycleId,
    setupId: input.frozenLevel != null ? buildSetupId(input.candidateId, input.lifecycleId, input.frozenLevelVersion ?? "none", input.frozenLevel) : `${input.candidateId}:pending`,
    state: "WARMUP" as BreakoutSetupState,
    frozenLevel: null,
    frozenLevelVersion: null,
    breakoutAtMs: null,
    retestAtMs: null,
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
    } else if (previousState === "TRIGGERED" && existing.lastTriggerAtMs != null && input.eventAtMs - existing.lastTriggerAtMs < BREAKOUT_REARM_COOLDOWN_MS) {
      reasonCode = "REARM_COOLDOWN_ACTIVE";
      newState = "TRIGGERED";
    } else {
      newState = "TRIGGERED";
      triggerGeneration += 1;
      lastSignalId = input.signalId;
      lastTriggerAtMs = input.eventAtMs;
      reasonCode = "ENTRY_TRIGGER_FIRED";
    }
  } else if (input.holdConfirmed) {
    newState = "HOLD_CONFIRMED";
    reasonCode = "HOLD_CONFIRMED";
  } else if (input.retestObserved) {
    newState = "RETEST_OBSERVED";
    reasonCode = "RETEST_OBSERVED";
    existing.retestAtMs = input.retestAtMs ?? input.eventAtMs;
  } else if (input.retestPending) {
    newState = "RETEST_PENDING";
    reasonCode = "RETEST_PENDING";
  } else if (input.breakoutConfirmed) {
    newState = "BREAKOUT_CONFIRMED";
    reasonCode = "BREAKOUT_CONFIRMED";
    existing.breakoutAtMs = input.breakoutAtMs ?? input.eventAtMs;
  } else if (input.levelReady && input.frozenLevel != null) {
    newState = "LEVEL_READY";
    if (existing.frozenLevel == null) {
      existing.frozenLevel = input.frozenLevel;
      existing.frozenLevelVersion = input.frozenLevelVersion;
      existing.setupStartedAtMs = input.eventAtMs;
      existing.setupId = buildSetupId(input.candidateId, input.lifecycleId, input.frozenLevelVersion ?? "pivot-v1", input.frozenLevel);
      reasonCode = "LEVEL_READY";
    } else {
      reasonCode = "LEVEL_FROZEN";
    }
  } else if (previousState === "WARMUP" && input.levelReady) {
    newState = "LEVEL_READY";
    reasonCode = "WARMUP_COMPLETE";
  }

  if (
    existing.setupStartedAtMs != null &&
    newState !== "TRIGGERED" &&
    newState !== "INVALIDATED" &&
    newState !== "EXPIRED" &&
    input.eventAtMs - existing.setupStartedAtMs > BREAKOUT_SETUP_EXPIRE_MS
  ) {
    newState = "EXPIRED";
    reasonCode = "SETUP_EXPIRED";
  }

  const record: BreakoutRecord = {
    ...existing,
    state: newState,
    triggerGeneration,
    lastSignalId,
    lastTriggerAtMs,
    frozenLevel: existing.frozenLevel ?? input.frozenLevel,
    frozenLevelVersion: existing.frozenLevelVersion ?? input.frozenLevelVersion,
    breakoutAtMs: existing.breakoutAtMs,
    retestAtMs: existing.retestAtMs,
  };
  store.set(id, record);

  return {
    candidateId: input.candidateId,
    lifecycleId: input.lifecycleId,
    strategyId: "BREAKOUT_RETEST",
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

export function getBreakoutTriggerGeneration(candidateId: string, lifecycleId: string) {
  return store.get(key(candidateId, lifecycleId))?.triggerGeneration ?? 0;
}

export function getBreakoutLastSignalId(candidateId: string, lifecycleId: string) {
  return store.get(key(candidateId, lifecycleId))?.lastSignalId ?? null;
}

export function shouldSuppressBreakoutDuplicate(candidateId: string, lifecycleId: string, signalId: string) {
  return store.get(key(candidateId, lifecycleId))?.lastSignalId === signalId;
}

export function getFrozenBreakoutLevel(candidateId: string, lifecycleId: string) {
  const row = store.get(key(candidateId, lifecycleId));
  return row ? { level: row.frozenLevel, version: row.frozenLevelVersion, breakoutAtMs: row.breakoutAtMs } : null;
}
