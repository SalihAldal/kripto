export function createRuntimeInstanceId(prefix: string) {
  const g = globalThis as typeof globalThis & {
    __runtimeInstanceCounters?: Record<string, number>;
  };
  if (!g.__runtimeInstanceCounters) g.__runtimeInstanceCounters = {};
  g.__runtimeInstanceCounters[prefix] = (g.__runtimeInstanceCounters[prefix] ?? 0) + 1;
  const seq = g.__runtimeInstanceCounters[prefix];
  return `${prefix}:${process.pid}:${seq}:${Math.random().toString(36).slice(2, 8)}`;
}
