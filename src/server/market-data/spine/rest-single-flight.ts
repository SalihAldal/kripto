import type { SharedKv } from "@/src/server/market-data/spine/shared-kv";

export class RestSingleFlight {
  constructor(
    private kv: SharedKv,
    private readonly prefix = "binance:rest:lock",
  ) {}

  setKv(kv: SharedKv) {
    this.kv = kv;
  }

  async run<T>(resource: string, factory: () => Promise<T>, ttlSec = 15): Promise<T> {
    const key = `${this.prefix}:${resource}`;
    const token = `${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const acquired = await this.kv.setNx(key, token, ttlSec);
    if (!acquired) {
      throw new Error(`REST_SINGLE_FLIGHT_BUSY:${resource}`);
    }
    try {
      return await factory();
    } finally {
      const current = await this.kv.get(key);
      if (current === token) await this.kv.del(key);
    }
  }
}
