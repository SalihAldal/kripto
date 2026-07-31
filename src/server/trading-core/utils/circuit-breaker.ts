export type CircuitBreakerState = "closed" | "open" | "half-open";

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private state: CircuitBreakerState = "closed";

  constructor(
    private readonly failureThreshold: number,
    private readonly cooldownMs: number,
  ) {}

  get snapshot() {
    return {
      state: this.state,
      failures: this.failures,
      openedAt: this.openedAt,
      cooldownMs: this.cooldownMs,
    };
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.openedAt < this.cooldownMs) {
        throw new Error("Circuit breaker is open");
      }
      this.state = "half-open";
    }

    try {
      const result = await operation();
      this.failures = 0;
      this.state = "closed";
      return result;
    } catch (error) {
      this.failures += 1;
      if (this.failures >= this.failureThreshold) {
        this.state = "open";
        this.openedAt = Date.now();
      }
      throw error;
    }
  }
}
