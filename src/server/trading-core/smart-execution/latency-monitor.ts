export class LatencyMonitor {
  private readonly samples = new Map<string, number[]>();

  record(venue: string, latencyMs: number) {
    const rows = this.samples.get(venue) ?? [];
    rows.push(latencyMs);
    this.samples.set(venue, rows.slice(-100));
  }

  average(venue: string) {
    const rows = this.samples.get(venue) ?? [];
    if (rows.length === 0) return 0;
    return rows.reduce((sum, value) => sum + value, 0) / rows.length;
  }

  snapshot() {
    return Array.from(this.samples.entries()).map(([venue, rows]) => ({
      venue,
      avgLatencyMs: Number(this.average(venue).toFixed(2)),
      p95LatencyMs: rows.length ? rows.slice().sort((a, b) => a - b)[Math.floor(rows.length * 0.95)] ?? 0 : 0,
      samples: rows.length,
    }));
  }
}
