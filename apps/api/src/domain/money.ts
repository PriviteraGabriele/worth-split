const centsPattern = /^(0|[1-9]\d*)$/;

export function parseCents(value: string): bigint {
  if (!centsPattern.test(value)) throw new Error('INVALID_AMOUNT');
  return BigInt(value);
}

export function requirePositive(value: string): bigint {
  const amount = parseCents(value);
  if (amount <= 0n) throw new Error('AMOUNT_MUST_BE_POSITIVE');
  return amount;
}

export function applyDelta(balance: bigint, delta: bigint): bigint {
  const next = balance + delta;
  if (next < 0n) throw new Error('INSUFFICIENT_BALANCE');
  return next;
}

export function total(values: bigint[]): bigint {
  return values.reduce((sum, value) => sum + value, 0n);
}
