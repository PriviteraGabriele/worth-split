import { describe, expect, it } from 'vitest';
import { applyDelta, parseCents, requirePositive, total } from '../src/domain/money.js';

describe('money', () => {
  it('parses deterministic integer cents', () => expect(parseCents('175000')).toBe(175000n));
  it('rejects decimals and unsafe formats', () => {
    expect(() => parseCents('17.50')).toThrow('INVALID_AMOUNT');
    expect(() => parseCents('-1')).toThrow('INVALID_AMOUNT');
  });
  it('requires positive operation amounts', () => expect(() => requirePositive('0')).toThrow('AMOUNT_MUST_BE_POSITIVE'));
  it('prevents negative balances', () => expect(() => applyDelta(100n, -101n)).toThrow('INSUFFICIENT_BALANCE'));
  it('calculates totals without floating point', () => expect(total([10n, 20n, 30n])).toBe(60n));
});
