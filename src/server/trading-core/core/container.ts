type Token<T> = string & { readonly __type?: T };
type Factory<T> = (container: TradingCoreContainer) => T;

export function token<T>(name: string): Token<T> {
  return name as Token<T>;
}

export class TradingCoreContainer {
  private readonly factories = new Map<string, Factory<unknown>>();
  private readonly instances = new Map<string, unknown>();

  register<T>(key: Token<T>, factory: Factory<T>) {
    if (this.instances.has(key)) {
      throw new Error(`Cannot register ${key}; instance already resolved`);
    }
    this.factories.set(key, factory as Factory<unknown>);
    return this;
  }

  registerValue<T>(key: Token<T>, value: T) {
    this.instances.set(key, value);
    return this;
  }

  resolve<T>(key: Token<T>): T {
    if (this.instances.has(key)) return this.instances.get(key) as T;
    const factory = this.factories.get(key);
    if (!factory) throw new Error(`Dependency not registered: ${key}`);
    const value = factory(this);
    this.instances.set(key, value);
    return value as T;
  }

  has<T>(key: Token<T>) {
    return this.instances.has(key) || this.factories.has(key);
  }
}
