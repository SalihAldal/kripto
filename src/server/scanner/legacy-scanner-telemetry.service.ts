type LegacyScope = {
  runId?: string;
  roundId?: string;
  source?: string;
};

type LegacyCounter = {
  total: number;
  byRun: Record<string, number>;
  byRound: Record<string, number>;
  recent: Array<{ at: string; runId: string; roundId: string; source: string }>;
};

type LegacyScannerTelemetry = {
  invocation: LegacyCounter;
  persistence: LegacyCounter;
};

const RECENT_LIMIT = 200;

function emptyCounter(): LegacyCounter {
  return { total: 0, byRun: {}, byRound: {}, recent: [] };
}

function getState() {
  const g = globalThis as typeof globalThis & {
    __legacyScannerTelemetry?: LegacyScannerTelemetry;
  };
  if (!g.__legacyScannerTelemetry) {
    g.__legacyScannerTelemetry = {
      invocation: emptyCounter(),
      persistence: emptyCounter(),
    };
  }
  return g.__legacyScannerTelemetry;
}

function add(counter: LegacyCounter, scope?: LegacyScope) {
  counter.total += 1;
  const runId = String(scope?.runId ?? "GLOBAL");
  const roundId = String(scope?.roundId ?? "GLOBAL");
  const source = String(scope?.source ?? "unknown");
  counter.byRun[runId] = (counter.byRun[runId] ?? 0) + 1;
  counter.byRound[roundId] = (counter.byRound[roundId] ?? 0) + 1;
  counter.recent.push({
    at: new Date().toISOString(),
    runId,
    roundId,
    source,
  });
  if (counter.recent.length > RECENT_LIMIT) {
    counter.recent.splice(0, counter.recent.length - RECENT_LIMIT);
  }
}

export function recordLegacyScannerInvocation(scope?: LegacyScope) {
  add(getState().invocation, scope);
}

export function recordLegacyScannerPersistence(scope?: LegacyScope) {
  add(getState().persistence, scope);
}

export function getLegacyScannerTelemetry(input?: { runId?: string; roundId?: string }) {
  const state = getState();
  const runId = input?.runId ? String(input.runId) : null;
  const roundId = input?.roundId ? String(input.roundId) : null;
  const runScopedInvocation = runId ? Number(state.invocation.byRun[runId] ?? 0) : state.invocation.total;
  const runScopedPersistence = runId ? Number(state.persistence.byRun[runId] ?? 0) : state.persistence.total;
  const roundScopedInvocation = roundId ? Number(state.invocation.byRound[roundId] ?? 0) : undefined;
  const roundScopedPersistence = roundId ? Number(state.persistence.byRound[roundId] ?? 0) : undefined;
  return {
    invocationTotal: state.invocation.total,
    persistenceTotal: state.persistence.total,
    invocationByRun: { ...state.invocation.byRun },
    persistenceByRun: { ...state.persistence.byRun },
    runScopedInvocation,
    runScopedPersistence,
    roundScopedInvocation,
    roundScopedPersistence,
    recentInvocations: state.invocation.recent.slice(-20),
    recentPersistence: state.persistence.recent.slice(-20),
  };
}

export function resetLegacyScannerTelemetry() {
  const state = getState();
  state.invocation = emptyCounter();
  state.persistence = emptyCounter();
}
