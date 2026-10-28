import { describe,expect,it } from 'vitest';
import { eurosToCents,formatEuro,percent,safeCents } from './money';
describe('money UI helpers',()=>{
  it('parses Italian decimals',()=>expect(eurosToCents('17,50')).toBe('1750'));
  it('rejects excess precision',()=>expect(()=>eurosToCents('1,001')).toThrow());
  it('calculates a stable percentage',()=>expect(percent('1','3')).toBe(33.3));
  it('formats cents without floating point rounding',()=>{
    expect(formatEuro('4823050')).toBe('€48.230,50');
    expect(formatEuro('900719925474099312')).toBe('€9.007.199.254.740.993,12');
    expect(formatEuro('-4500')).toBe('−€45,00');
    expect(formatEuro('15000',false,{sign:true})).toBe('+€150,00');
    expect(formatEuro('15000',true)).toBe('••••••');
  });
  it('treats invalid input as zero cents',()=>{
    expect(safeCents('12,5')).toBe(1250n);
    expect(safeCents('abc')).toBe(0n);
  });
});
