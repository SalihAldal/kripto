import type { Prisma } from "@prisma/client";
import { prisma } from "@/src/server/db/prisma";
import type { SelectedStrategySignal } from "@/src/server/execution/fix01-selected-signal";
import {
  getExitPolicyState,
  hydrateExitPolicyState,
  initializeExitPolicyState,
} from "@/src/server/profitability/pr04-exit-evaluator";
import type { ExitPolicySnapshot, ExitPolicyState } from "@/src/server/profitability/pr04-types";
import { PR04_SCHEMA_VERSION } from "@/src/server/profitability/pr04-types";

export const FIX02_EXIT_PERSISTENCE_SCHEMA = "fix02-exit-persistence-v1" as const;

export type PersistedExitBundle = {
  positionId: string;
  userId: string;
  selectedSignal: SelectedStrategySignal | null;
  snapshot: ExitPolicySnapshot;
  state: ExitPolicyState;
  stateVersion: number;
  terminalStatus: string;
  processedFillIds: string[];
  activeExitIntentId: string | null;
  reconciliationStatus: string;
  ownerExecutionId: string | null;
  ownerFenceToken: string | null;
};

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function persistExitBundleAtEntry(input: {
  userId: string;
  positionId: string;
  selectedSignal: SelectedStrategySignal | null;
  snapshot: ExitPolicySnapshot;
  state: ExitPolicyState;
  ownerExecutionId?: string | null;
  ownerFenceToken?: string | null;
}) {
  const bundle: PersistedExitBundle = {
    positionId: input.positionId,
    userId: input.userId,
    selectedSignal: input.selectedSignal ? cloneJson(input.selectedSignal) : null,
    snapshot: cloneJson(input.snapshot),
    state: cloneJson(input.state),
    stateVersion: input.state.version,
    terminalStatus: input.state.terminalStatus,
    processedFillIds: [],
    activeExitIntentId: null,
    reconciliationStatus: "OK",
    ownerExecutionId: input.ownerExecutionId ?? null,
    ownerFenceToken: input.ownerFenceToken ?? null,
  };
  await prisma.positionExitPersistedState.upsert({
    where: { positionId: input.positionId },
    update: {
      userId: input.userId,
      schemaVersion: FIX02_EXIT_PERSISTENCE_SCHEMA,
      selectedSignal: bundle.selectedSignal as Prisma.InputJsonValue,
      snapshot: bundle.snapshot as Prisma.InputJsonValue,
      state: bundle.state as Prisma.InputJsonValue,
      stateVersion: bundle.stateVersion,
      terminalStatus: bundle.terminalStatus,
      processedFillIds: bundle.processedFillIds as Prisma.InputJsonValue,
      activeExitIntentId: null,
      reconciliationStatus: "OK",
      ownerExecutionId: bundle.ownerExecutionId,
      ownerFenceToken: bundle.ownerFenceToken,
    },
    create: {
      positionId: input.positionId,
      userId: input.userId,
      schemaVersion: FIX02_EXIT_PERSISTENCE_SCHEMA,
      selectedSignal: bundle.selectedSignal as Prisma.InputJsonValue,
      snapshot: bundle.snapshot as Prisma.InputJsonValue,
      state: bundle.state as Prisma.InputJsonValue,
      stateVersion: bundle.stateVersion,
      terminalStatus: bundle.terminalStatus,
      processedFillIds: bundle.processedFillIds as Prisma.InputJsonValue,
      reconciliationStatus: "OK",
      ownerExecutionId: bundle.ownerExecutionId,
      ownerFenceToken: bundle.ownerFenceToken,
    },
  });
  return bundle;
}

export async function loadPersistedExitBundle(positionId: string): Promise<PersistedExitBundle | null> {
  const row = await prisma.positionExitPersistedState.findUnique({ where: { positionId } });
  if (!row) return null;
  return {
    positionId: row.positionId,
    userId: row.userId,
    selectedSignal: (row.selectedSignal as SelectedStrategySignal | null) ?? null,
    snapshot: row.snapshot as ExitPolicySnapshot,
    state: row.state as ExitPolicyState,
    stateVersion: row.stateVersion,
    terminalStatus: row.terminalStatus,
    processedFillIds: Array.isArray(row.processedFillIds) ? (row.processedFillIds as string[]) : [],
    activeExitIntentId: row.activeExitIntentId,
    reconciliationStatus: row.reconciliationStatus,
    ownerExecutionId: row.ownerExecutionId,
    ownerFenceToken: row.ownerFenceToken,
  };
}

export async function savePersistedExitState(input: {
  positionId: string;
  expectedVersion: number;
  state: ExitPolicyState;
  processedFillIds?: string[];
  activeExitIntentId?: string | null;
  reconciliationStatus?: string;
}) {
  const updated = await prisma.positionExitPersistedState.updateMany({
    where: { positionId: input.positionId, stateVersion: input.expectedVersion },
    data: {
      state: cloneJson(input.state) as Prisma.InputJsonValue,
      stateVersion: input.state.version,
      terminalStatus: input.state.terminalStatus,
      processedFillIds: (input.processedFillIds ?? []) as Prisma.InputJsonValue,
      activeExitIntentId: input.activeExitIntentId ?? null,
      reconciliationStatus: input.reconciliationStatus ?? "OK",
    },
  });
  if (updated.count !== 1) {
    throw new Error(`EXIT_STATE_VERSION_CONFLICT:${input.positionId}`);
  }
}

export async function restoreExitPolicyStateFromDb(positionId: string): Promise<ExitPolicyState | null> {
  const bundle = await loadPersistedExitBundle(positionId);
  if (!bundle) return getExitPolicyState(positionId);
  hydrateExitPolicyState(bundle.state);
  return getExitPolicyState(positionId);
}

export async function bootstrapExitPersistenceAtEntry(input: {
  userId: string;
  positionId: string;
  selectedSignal: SelectedStrategySignal | null;
  snapshot: ExitPolicySnapshot;
  side: "LONG" | "SHORT";
  entryFills: Array<{ price: number; quantity: number; fee: number; atMs: number }>;
  entryFee: number;
  ownerExecutionId?: string | null;
}) {
  const state = initializeExitPolicyState({
    snapshot: input.snapshot,
    side: input.side,
    entryFills: input.entryFills,
    entryFee: input.entryFee,
  });
  await persistExitBundleAtEntry({
    userId: input.userId,
    positionId: input.positionId,
    selectedSignal: input.selectedSignal,
    snapshot: input.snapshot,
    state,
    ownerExecutionId: input.ownerExecutionId ?? null,
    ownerFenceToken: input.ownerExecutionId ? `${input.ownerExecutionId}:${input.positionId}` : null,
  });
  return state;
}

export async function syncExitStateToDb(positionId: string) {
  const state = getExitPolicyState(positionId);
  if (!state) return null;
  const bundle = await loadPersistedExitBundle(positionId);
  if (!bundle) return null;
  await savePersistedExitState({
    positionId,
    expectedVersion: bundle.stateVersion,
    state,
    processedFillIds: bundle.processedFillIds,
    activeExitIntentId: bundle.activeExitIntentId,
    reconciliationStatus: bundle.reconciliationStatus,
  });
  return state;
}

export function isProcessedFillId(bundle: PersistedExitBundle, fillId: string) {
  return bundle.processedFillIds.includes(fillId);
}

export async function markProcessedFillId(positionId: string, fillId: string) {
  const bundle = await loadPersistedExitBundle(positionId);
  if (!bundle) return;
  if (bundle.processedFillIds.includes(fillId)) return;
  const next = [...bundle.processedFillIds, fillId];
  await savePersistedExitState({
    positionId,
    expectedVersion: bundle.stateVersion,
    state: getExitPolicyState(positionId) ?? bundle.state,
    processedFillIds: next,
    activeExitIntentId: bundle.activeExitIntentId,
    reconciliationStatus: bundle.reconciliationStatus,
  });
}

export async function deletePersistedExitBundle(positionId: string) {
  await prisma.positionExitPersistedState.deleteMany({ where: { positionId } });
}

export { PR04_SCHEMA_VERSION };
