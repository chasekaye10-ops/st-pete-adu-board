import { describe, expect, it } from 'vitest';
import type { Listing } from '../../src/domain/types.js';
import { calculateAnnualCarry, isVerifiedFloodX, rankListings } from '../../src/domain/calculations.js';

function candidate(id: string, changes: Partial<Listing> = {}): Listing {
  return { id, address: id, price: 365000, bedsBaths: '3/2', houseSf: 1950,
    maxAdu: 800, adu: 'yes', lifecycle: 'active', evidence: [], history: [],
    updatedAt: '2026-09-08', ...changes };
}
const flood = { kind: 'flood', source: 'legacy-board-export', capturedAt: '2026-09-08',
  detail: 'Zone X — property record, not listing copy' };

describe('annual carry estimate', () => {
  it.each([[279900, 33424], [365000, 41610], [437000, 48535]])('estimates %i as %i annually', (price, expected) => {
    expect(calculateAnnualCarry(price)).toBe(expected);
  });
});

describe('flood evidence', () => {
  it('recognizes the imported property-record citation', () => {
    expect(isVerifiedFloodX(candidate('x', { evidence: [flood] }))).toBe(true);
  });
  it.each(['Zone X, per listing', 'Not in a flood zone', 'Zone X unverified', 'Not Zone X, property record'])('does not verify %s', detail => {
    expect(isVerifiedFloodX(candidate('x', { evidence: [{ ...flood, detail }] }))).toBe(false);
  });
  it('does not promote conflicting flood evidence', () => {
    expect(isVerifiedFloodX(candidate('x', { evidence: [flood, { ...flood, detail: 'AE, single MLS source' }] }))).toBe(false);
  });
});

describe('candidate ranking', () => {
  it('places an 800-sf block candidate ahead of a 653-sf frame candidate', () => {
    const best = candidate('best', { construction: 'block', evidence: [flood] });
    const smaller = candidate('smaller', { maxAdu: 653, construction: 'frame' });
    expect(rankListings([smaller, best])).toEqual([best, smaller]);
  });
  it.each([
    [{ adu: 'staff' }, { adu: 'unknown' }],
    [{ adu: 'yes', maxAdu: 653 }, { adu: 'staff', maxAdu: 800 }],
    [{ evidence: [flood], price: 400000 }, { price: 300000 }],
    [{ conversionStructure: 'attached garage' }, { conversionStructure: 'garage assumed', achievableAdu: 600 }],
    [{ achievableAdu: 440, construction: 'frame' }, { achievableAdu: 300, construction: 'block' }],
    [{ construction: 'block', price: 400000 }, { construction: 'frame', price: 300000 }],
    [{ convertibleSpace: 'Attached garage · block, built 1952', price: 400000 }, { construction: 'frame', price: 300000 }],
    [{ price: 300000 }, { price: 400000 }],
  ] as [Partial<Listing>, Partial<Listing>][])('applies each priority before lower-priority criteria', (a, b) => {
    const first = candidate('first', a), second = candidate('second', b);
    expect(rankListings([second, first])).toEqual([first, second]);
  });
  it('excludes all non-active listings without mutating the input', () => {
    const active = candidate('active');
    const rows = [candidate('uc', { lifecycle: 'under_contract' }), active,
      candidate('out', { lifecycle: 'ruled_out' }), candidate('gone', { lifecycle: 'gone' }),
      candidate('check', { lifecycle: 'needs_verification' })];
    const before = structuredClone(rows);
    expect(rankListings(rows)).toEqual([active]);
    expect(rows).toEqual(before);
  });
});
