import { describe, expect, it } from 'vitest';
import { importLegacy, parseLegacyRows } from '../../src/import/legacy.js';

describe('importLegacy', () => {
  it('keeps conversion costs and structures separate from construction and eligibility', () => {
    const listing = importLegacy([{ a: 'Example', t: 'eligible', dq: true,
      cc: 50000, st: 'garage', fzAe: 'AE, single MLS source' }], '2026-09-08').listings[0];
    expect(listing).toMatchObject({ adu: 'yes', lifecycle: 'ruled_out',
      conversionEstimate: 50000, conversionStructure: 'garage' });
    expect(listing.construction).toBeUndefined();
    expect(listing.evidence).toContainEqual(expect.objectContaining({ kind: 'flood', detail: 'AE, single MLS source' }));
  });

  it('keeps unverified and out-of-scope rows out of the active queue', () => {
    const listings = importLegacy([{ a: 'Unverified', t: 'unverified' },
      { a: 'Outside', t: 'out' }], '2026-09-08').listings;
    expect(listings.map(row => row.lifecycle)).toEqual(['needs_verification', 'ruled_out']);
  });
  it('imports 4219 as an active strong match with the documented facts', () => {
    const state = importLegacy([
      {
        a: '4219 5th Ave N',
        p: 365000,
        bd: '3/2',
        sf: 1950,
        z: 'NTM-1',
        lot: 5502,
        t: 'strong',
        cv: 'Attached 2-car garage',
      },
    ], '2026-09-07');

    expect(state.listings[0]).toMatchObject({
      address: '4219 5th Ave N',
      price: 365000,
      maxAdu: 800,
      lifecycle: 'active',
      adu: 'yes',
    });
  });

  it('preserves legacy flags and notes as evidence', () => {
    const state = importLegacy([{
      a: '100 Main St',
      p: '400,000',
      sf: 1000,
      uc: true,
      fz: 'X',
      note: 'Verify garage dimensions',
      customFlag: 'keep me',
    }], '2026-09-07');

    expect(state.listings[0]).toMatchObject({ lifecycle: 'under_contract', adu: 'unknown' });
    expect(state.listings[0].evidence[0].legacyNote).toMatchObject({
      uc: true,
      note: 'Verify garage dimensions',
      customFlag: 'keep me',
    });
  });

  it('rejects legacy rows without an address', () => {
    expect(() => parseLegacyRows([{ p: 400000 }])).toThrow(/address/i);
  });
});
