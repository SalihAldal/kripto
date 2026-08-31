import { MemoryKv, type SharedKv } from "@/src/server/market-data/spine/shared-kv";
import { DistributedRestLimiter } from "@/src/server/market-data/spine/distributed-rest-limiter";

const fallbackKv = new MemoryKv();
let limiter = new DistributedRestLimiter(fallbackKv);

export function getSharedRestLimiter() {
  return limiter;
}

export function bindSharedRestLimiterKv(kv: SharedKv) {
  limiter.setKv(kv);
}

export function resetSharedRestLimiterForTests(kv: SharedKv = new MemoryKv()) {
  limiter = new DistributedRestLimiter(kv);
  return limiter;
}
