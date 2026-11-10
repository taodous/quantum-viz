/**
 * In-memory token bucket, per key (session id, IP).
 *
 * It lives in the function instance: with several instances the effective
 * limit is multiplied by their number. Good enough for one class; it exists to
 * stop a runaway script, not to bill anyone.
 */
export class TokenBucket {
  private buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private capacity: number,
    private refillPerSecond: number,
    private maxKeys = 5_000,
  ) {}

  /** Take one token. `retryAfterS` says when the next one will be there. */
  take(key: string, now = Date.now()): { ok: boolean; retryAfterS: number } {
    let b = this.buckets.get(key);
    if (b) {
      b.tokens = Math.min(this.capacity, b.tokens + ((now - b.at) / 1000) * this.refillPerSecond);
      b.at = now;
    } else {
      if (this.buckets.size >= this.maxKeys) this.evict(now);
      b = { tokens: this.capacity, at: now };
      this.buckets.set(key, b);
    }
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return { ok: true, retryAfterS: 0 };
    }
    return { ok: false, retryAfterS: Math.ceil((1 - b.tokens) / this.refillPerSecond) };
  }

  /** Drop buckets that are full again (idle keys), then the oldest if needed. */
  private evict(now: number) {
    const fullAfterMs = (this.capacity / this.refillPerSecond) * 1000;
    for (const [k, b] of this.buckets) if (now - b.at > fullAfterMs) this.buckets.delete(k);
    if (this.buckets.size >= this.maxKeys) this.buckets.delete(this.buckets.keys().next().value!);
  }
}
