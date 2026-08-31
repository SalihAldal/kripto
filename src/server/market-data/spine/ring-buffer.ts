export type TickSample = {
  t: number;
  price: number;
  quoteVolume: number;
  baseVolume: number;
};

const DEFAULT_CAPACITY = 1024;

export class BoundedRingBuffer {
  private readonly times: Float64Array;
  private readonly prices: Float64Array;
  private readonly quoteVolumes: Float64Array;
  private readonly baseVolumes: Float64Array;
  private head = 0;
  private length = 0;
  readonly capacity: number;

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = Math.max(16, Math.floor(capacity));
    this.times = new Float64Array(this.capacity);
    this.prices = new Float64Array(this.capacity);
    this.quoteVolumes = new Float64Array(this.capacity);
    this.baseVolumes = new Float64Array(this.capacity);
  }

  get size() {
    return this.length;
  }

  push(sample: TickSample) {
    if (this.length < this.capacity) {
      const index = (this.head + this.length) % this.capacity;
      this.write(index, sample);
      this.length += 1;
      return;
    }
    this.write(this.head, sample);
    this.head = (this.head + 1) % this.capacity;
  }

  latest(): TickSample | null {
    if (this.length === 0) return null;
    const index = (this.head + this.length - 1) % this.capacity;
    return this.readIndex(index);
  }

  oldest(): TickSample | null {
    if (this.length === 0) return null;
    return this.readIndex(this.head);
  }

  priceAtOrBefore(targetTime: number): number | null {
    return this.sampleAtOrBefore(targetTime)?.price ?? null;
  }

  sampleAtOrBefore(targetTime: number): TickSample | null {
    if (this.length === 0) return null;
    let found: TickSample | null = null;
    for (let i = 0; i < this.length; i += 1) {
      const index = (this.head + i) % this.capacity;
      if (this.times[index] <= targetTime) found = this.readIndex(index);
      else if (found) break;
    }
    return found;
  }

  snapshot(): TickSample[] {
    const out: TickSample[] = [];
    for (let i = 0; i < this.length; i += 1) {
      out.push(this.readIndex((this.head + i) % this.capacity));
    }
    return out;
  }

  estimatedBytes() {
    return this.capacity * 8 * 4 + 24;
  }

  private write(index: number, sample: TickSample) {
    this.times[index] = sample.t;
    this.prices[index] = sample.price;
    this.quoteVolumes[index] = sample.quoteVolume;
    this.baseVolumes[index] = sample.baseVolume;
  }

  private readIndex(index: number): TickSample {
    return {
      t: this.times[index],
      price: this.prices[index],
      quoteVolume: this.quoteVolumes[index],
      baseVolume: this.baseVolumes[index],
    };
  }
}

export function createPriceRingBuffer(capacity = DEFAULT_CAPACITY) {
  return new BoundedRingBuffer(capacity);
}
