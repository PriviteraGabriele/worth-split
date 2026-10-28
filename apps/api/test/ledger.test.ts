import { describe, expect, it } from 'vitest';
import { rebalanceEntries, transferEntries, validateDistribution } from '../src/services/ledger.js';

describe('ledger input rules', () => {
  it('builds a balanced transfer', () => expect(transferEntries('a', 'b', '23000')).toEqual([
    { bucketId: 'a', amountCents: '-23000' }, { bucketId: 'b', amountCents: '23000' },
  ]));
  it('rejects a transfer to itself', () => expect(() => transferEntries('a', 'a', '1')).toThrow('SAME_BUCKET'));
  it('accepts an exactly allocated distribution', () => expect(validateDistribution([
    { bucketId: 'a', amountCents: '25000' }, { bucketId: 'b', amountCents: '150000' },
  ], '175000')).toHaveLength(2));
  it('rejects a distribution with a remainder', () => expect(() => validateDistribution([
    { bucketId: 'a', amountCents: '1' },
  ], '2')).toThrow('INVALID_DISTRIBUTION'));
  it('subtracts from the first selected bucket when rebalancing', () => expect(rebalanceEntries([
    { id: 'saving', balanceCents: '60000' }, { id: 'spending', balanceCents: '40000' },
  ], '70000')).toEqual([{ bucketId: 'saving', amountCents: '-30000' }]));
  it('spills a rebalance reduction into later selected buckets', () => expect(rebalanceEntries([
    { id: 'spending', balanceCents: '10000' }, { id: 'saving', balanceCents: '60000' },
  ], '20000')).toEqual([
    { bucketId: 'spending', amountCents: '-10000' }, { bucketId: 'saving', amountCents: '-40000' },
  ]));
  it('allows rebalancing a single bucket', () => expect(rebalanceEntries([
    { id: 'saving', balanceCents: '60000' },
  ], '40000')).toEqual([{ bucketId: 'saving', amountCents: '-20000' }]));
  it('credits the first selected bucket when rebalancing upwards', () => expect(rebalanceEntries([
    { id: 'saving', balanceCents: '60000' }, { id: 'spending', balanceCents: '40000' },
  ], '125000')).toEqual([{ bucketId: 'saving', amountCents: '25000' }]));
  it('rejects a rebalance with an unchanged total', () => expect(() => rebalanceEntries([
    { id: 'saving', balanceCents: '60000' },
  ], '60000')).toThrow('INVALID_REBALANCE_TOTAL'));
});
