/** Reserve discovery capacity before leaders can consume the entire scan budget.
 * nextCursor is the full-batch cursor; partial scans use attemptedPumpCursor.
 */
export function schedulePumpScan(input: { leaders: string[]; watchlist: string[]; cursor: number; limit: number; discoveryBatchSize: number }) {
  const limit = Number.isFinite(input.limit) ? Math.max(1, Math.floor(input.limit)) : 1;
  const universe = [...new Set(input.watchlist)];
  const cursor = universe.length ? Math.max(0, Math.floor(input.cursor) || 0) % universe.length : 0;
  const reserve = Math.min(universe.length, limit, Math.max(1, Math.min(Math.floor(input.discoveryBatchSize) || 1, Math.ceil(limit / 3))));
  const discovery = Array.from({ length: reserve }, (_, i) => universe[(cursor + i) % universe.length]);
  const discoverySet = new Set(discovery);
  const leaders = [...new Set(input.leaders)].filter(s => !discoverySet.has(s));
  // Discovery goes first so selection deadlines do not recreate leader starvation.
  const symbols = [...discovery, ...leaders.slice(0, limit - discovery.length)];
  let inspected = reserve;
  while (symbols.length < limit && inspected < universe.length) {
    const symbol = universe[(cursor + inspected++) % universe.length];
    if (!symbols.includes(symbol)) symbols.push(symbol);
  }
  return { symbols, discoverySymbols: discovery, nextCursor: universe.length ? (cursor + inspected) % universe.length : 0 };
}

export function attemptedPumpCursor(watchlist: string[], cursor: number, discovery: string[], attempted: ReadonlySet<string>) {
  const length = new Set(watchlist).size;
  if (!length) return 0;
  let prefix = 0;
  while (prefix < discovery.length && attempted.has(discovery[prefix])) prefix++;
  return (Math.max(0, Math.floor(cursor) || 0) + prefix) % length;
}
