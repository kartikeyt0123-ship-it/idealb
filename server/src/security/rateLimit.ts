import { AppError } from '../errors.js';

/**
 * In-process token-bucket rate limiter. Limits are per *key* (team id, admin
 * id, or ip+identifier). Login limits key on the submitted identifier as well
 * as the IP so a venue NAT shared by 100 teams does not lock everyone out.
 * For multi-instance deployments replace with a Redis-backed limiter.
 */
interface Bucket { tokens: number; updated: number }

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  constructor(private readonly capacity: number, private readonly refillPerSecond: number) {}

  take(key: string, cost = 1): boolean {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.capacity, updated: now };
      this.buckets.set(key, b);
    }
    b.tokens = Math.min(this.capacity, b.tokens + ((now - b.updated) / 1000) * this.refillPerSecond);
    b.updated = now;
    if (b.tokens < cost) return false;
    b.tokens -= cost;
    if (this.buckets.size > 50_000) this.sweep(now);
    return true;
  }

  enforce(key: string, message = 'Too many requests. Slow down, crewmate.') {
    if (!this.take(key)) throw new AppError('RATE_LIMITED', message);
  }

  private sweep(now: number) {
    for (const [k, b] of this.buckets) if (now - b.updated > 10 * 60_000) this.buckets.delete(k);
  }
}

export function createLimiters() {
  return {
    loginByIdentifier: new RateLimiter(8, 8 / 60), // 8 attempts, refills 8/min per identifier
    loginByIp: new RateLimiter(600, 10), // generous: a whole venue may share one NAT IP; brute force is limited per identifier
    register: new RateLimiter(30, 30 / 60), // per IP: venue NAT friendly
    answer: new RateLimiter(12, 12 / 60), // per team: 12 burst, 12/min
    run: new RateLimiter(10, 20 / 60), // per team: 10 burst, 20/min
    hint: new RateLimiter(10, 10 / 60),
    imposter: new RateLimiter(10, 20 / 60),
  };
}
export type Limiters = ReturnType<typeof createLimiters>;
