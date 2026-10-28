type Entry = { attempts: number; windowStartedAt: number; lockedUntil: number };

export type LoginThrottleOptions = {
  maxAttempts: number;
  windowMs: number;
  lockMs: number;
  maxEntries: number;
  now?: () => number;
};

export type LoginThrottleDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * Per-account brute-force protection that complements the per-IP limit, so a
 * distributed attack against one e-mail is stopped as well. An attempt is
 * reserved before the password is verified: concurrent requests cannot all
 * pass the check while the first verifications are still running.
 * Unknown e-mails are throttled exactly like existing ones, so a lock never
 * reveals whether an account exists.
 */
export class LoginThrottle {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;

  constructor(private readonly options: LoginThrottleOptions) {
    this.now = options.now ?? Date.now;
  }

  reserve(key: string): LoginThrottleDecision {
    const now = this.now();
    let entry = this.entries.get(key);
    if (entry && entry.lockedUntil > now) return this.denied(entry, now);
    if (!entry || now - entry.windowStartedAt >= this.options.windowMs) {
      this.entries.delete(key);
      this.makeRoom(now);
      entry = { attempts: 0, windowStartedAt: now, lockedUntil: 0 };
      this.entries.set(key, entry);
    }
    entry.attempts += 1;
    if (entry.attempts > this.options.maxAttempts) {
      entry.lockedUntil = now + this.options.lockMs;
      return this.denied(entry, now);
    }
    return { allowed: true };
  }

  succeed(key: string): void {
    this.entries.delete(key);
  }

  private denied(entry: Entry, now: number): LoginThrottleDecision {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000)) };
  }

  // Memory stays bounded under a flood of random e-mails: expired entries are
  // dropped first, then the oldest ones (Map preserves insertion order).
  private makeRoom(now: number): void {
    if (this.entries.size < this.options.maxEntries) return;
    for (const [key, entry] of this.entries) {
      if (entry.lockedUntil <= now && now - entry.windowStartedAt >= this.options.windowMs) this.entries.delete(key);
    }
    for (const key of this.entries.keys()) {
      if (this.entries.size < this.options.maxEntries) break;
      this.entries.delete(key);
    }
  }
}
