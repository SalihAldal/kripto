export type SubscriptionCommandMethod = "SUBSCRIBE" | "UNSUBSCRIBE";

export type SubscriptionCommandBatch = {
  method: SubscriptionCommandMethod;
  params: string[];
};

export type SubscriptionCommandQueueTelemetry = {
  pendingSubscribe: number;
  pendingUnsubscribe: number;
  subscriptionRequested: number;
  subscriptionActivated: number;
  subscriptionRemoved: number;
  duplicateSubscriptionSuppressed: number;
  commandsLast1s: number;
  commandsLast5s: number;
  controlCommandsPerSecMax: number;
  controlRateViolation: number;
};

export class SubscriptionCommandQueue {
  private readonly pendingSubscribe = new Set<string>();
  private readonly pendingUnsubscribe = new Set<string>();
  private readonly sentAt: number[] = [];
  private commandsPerSecMaxSeen = 0;
  private controlRateViolation = 0;
  private subscriptionRequested = 0;
  private subscriptionActivated = 0;
  private subscriptionRemoved = 0;
  private duplicateSubscriptionSuppressed = 0;

  constructor(private readonly maxControlCommandsPerSec: number) {}

  enqueue(method: SubscriptionCommandMethod, streams: string[]) {
    for (const stream of streams) {
      if (!stream) continue;
      if (method === "SUBSCRIBE") {
        if (this.pendingSubscribe.has(stream)) {
          this.duplicateSubscriptionSuppressed += 1;
          continue;
        }
        this.pendingUnsubscribe.delete(stream);
        this.pendingSubscribe.add(stream);
        this.subscriptionRequested += 1;
        continue;
      }
      if (this.pendingUnsubscribe.has(stream)) {
        this.duplicateSubscriptionSuppressed += 1;
        continue;
      }
      this.pendingSubscribe.delete(stream);
      this.pendingUnsubscribe.add(stream);
    }
  }

  dequeueBatch(now = Date.now()): SubscriptionCommandBatch | null {
    this.trimWindow(now);
    if (this.sentAt.length >= this.maxControlCommandsPerSec) return null;
    if (this.pendingSubscribe.size > 0) {
      const params = [...this.pendingSubscribe];
      this.pendingSubscribe.clear();
      this.markSent(now);
      this.subscriptionActivated += params.length;
      return { method: "SUBSCRIBE", params };
    }
    if (this.pendingUnsubscribe.size > 0) {
      const params = [...this.pendingUnsubscribe];
      this.pendingUnsubscribe.clear();
      this.markSent(now);
      this.subscriptionRemoved += params.length;
      return { method: "UNSUBSCRIBE", params };
    }
    return null;
  }

  telemetry(now = Date.now()): SubscriptionCommandQueueTelemetry {
    this.trimWindow(now);
    return {
      pendingSubscribe: this.pendingSubscribe.size,
      pendingUnsubscribe: this.pendingUnsubscribe.size,
      subscriptionRequested: this.subscriptionRequested,
      subscriptionActivated: this.subscriptionActivated,
      subscriptionRemoved: this.subscriptionRemoved,
      duplicateSubscriptionSuppressed: this.duplicateSubscriptionSuppressed,
      commandsLast1s: this.sentAt.length,
      commandsLast5s: this.sentAt.filter((ts) => now - ts <= 5000).length,
      controlCommandsPerSecMax: this.commandsPerSecMaxSeen,
      controlRateViolation: this.controlRateViolation,
    };
  }

  reset() {
    this.pendingSubscribe.clear();
    this.pendingUnsubscribe.clear();
    this.sentAt.length = 0;
    this.commandsPerSecMaxSeen = 0;
    this.controlRateViolation = 0;
    this.subscriptionRequested = 0;
    this.subscriptionActivated = 0;
    this.subscriptionRemoved = 0;
    this.duplicateSubscriptionSuppressed = 0;
  }

  private trimWindow(now: number) {
    while (this.sentAt.length > 0 && now - this.sentAt[0] > 1000) {
      this.sentAt.shift();
    }
  }

  private markSent(now: number) {
    this.sentAt.push(now);
    if (this.sentAt.length > this.commandsPerSecMaxSeen) {
      this.commandsPerSecMaxSeen = this.sentAt.length;
    }
    if (this.sentAt.length > this.maxControlCommandsPerSec) {
      this.controlRateViolation += 1;
    }
  }
}
