type Window = { count: number; startedAt: number };

export type UserWriteLimitOptions = { max: number; windowMs: number; now?: () => number };
export type UserWriteDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * Limits state-changing requests per account, in addition to the per-IP
 * limits: an account spreading its requests over many addresses still gets a
 * single budget. There is one entry per account, so memory stays bounded by
 * the number of accounts.
 */
export class UserWriteLimiter {
  private readonly windows = new Map<string, Window>();
  private readonly now: () => number;

  constructor(private readonly options: UserWriteLimitOptions) {
    this.now = options.now ?? Date.now;
  }

  reserve(userId: string): UserWriteDecision {
    const now = this.now();
    let window = this.windows.get(userId);
    if (!window || now - window.startedAt >= this.options.windowMs) {
      window = { count: 0, startedAt: now };
      this.windows.set(userId, window);
    }
    window.count += 1;
    if (window.count <= this.options.max) return { allowed: true };
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((window.startedAt + this.options.windowMs - now) / 1000)) };
  }
}
