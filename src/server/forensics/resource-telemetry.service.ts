import { monitorEventLoopDelay } from "node:perf_hooks";

type ResourceSample = {
  timestamp: string;
  cpuPercent: number | null;
  eventLoopLagP95Ms: number | null;
  memory: {
    rssMB: number;
    heapUsedMB: number;
    heapTotalMB: number;
    externalMB: number;
    arrayBuffersMB: number;
  };
  alerts: string[];
};

const loopMonitor = monitorEventLoopDelay({ resolution: 20 });
loopMonitor.enable();

let lastCpu = process.cpuUsage();
let lastAt = Date.now();

function toMb(value: number) {
  return Number((value / (1024 * 1024)).toFixed(3));
}

export function sampleResourceTelemetry(): ResourceSample {
  const now = Date.now();
  const elapsedMicros = Math.max(1, (now - lastAt) * 1000);
  const currentCpu = process.cpuUsage();
  const userDelta = currentCpu.user - lastCpu.user;
  const sysDelta = currentCpu.system - lastCpu.system;
  const cpuPercent = Number((((userDelta + sysDelta) / elapsedMicros) * 100).toFixed(3));
  lastCpu = currentCpu;
  lastAt = now;

  const mem = process.memoryUsage();
  const eventLoopLagP95Ms = Number((loopMonitor.percentile(95) / 1_000_000).toFixed(3));
  loopMonitor.reset();

  const sample: ResourceSample = {
    timestamp: new Date(now).toISOString(),
    cpuPercent,
    eventLoopLagP95Ms,
    memory: {
      rssMB: toMb(mem.rss),
      heapUsedMB: toMb(mem.heapUsed),
      heapTotalMB: toMb(mem.heapTotal),
      externalMB: toMb(mem.external),
      arrayBuffersMB: toMb(mem.arrayBuffers),
    },
    alerts: [],
  };

  if (sample.eventLoopLagP95Ms != null && sample.eventLoopLagP95Ms > 120) {
    sample.alerts.push("EVENT_LOOP_LAG_HIGH");
  }
  if (sample.memory.heapUsedMB > 1024) {
    sample.alerts.push("HEAP_GROWTH_WARNING");
  }
  return sample;
}
