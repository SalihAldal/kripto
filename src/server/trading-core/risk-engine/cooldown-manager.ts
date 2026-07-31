export class CooldownManager {
  private readonly cooldowns = new Map<string, number>();

  set(key: string, durationMs: number) {
    const until = Date.now() + Math.max(0, durationMs);
    this.cooldowns.set(key, until);
    return until;
  }

  getActive(key: string) {
    const until = this.cooldowns.get(key) ?? 0;
    if (until <= Date.now()) {
      this.cooldowns.delete(key);
      return null;
    }
    return until;
  }

  clear(key: string) {
    this.cooldowns.delete(key);
  }
}
