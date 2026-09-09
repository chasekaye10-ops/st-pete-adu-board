import { expect, it } from 'vitest';
import { importLegacy } from '../../src/import/legacy.js';
import { mergeScan, type Observation } from '../../src/scan/merge.js';
import { rankListings } from '../../src/domain/calculations.js';

const previous = () => importLegacy([{ a: '4219 5th Ave N', p: 365000, sf: 1950, bd: '3/2', t: 'strong', note: 'Keep this note', cc: 62000 }], '2026-09-08');
function observation(changes: Partial<Observation> = {}): Observation {
  return { mode: 'narrow', candidate: { address: '4219 5TH AVENUE N', price: 355000, houseSf: 1950,
    bedsBaths: '3/2', maxAdu: 800, propertyType: 'single_family', source: 'Trulia',
    sourceUrl: 'https://www.trulia.com/home/4219', indexUrl: 'https://www.trulia.com/FL/',
    fetchedAt: '2026-09-09', snippet: 'Attached garage' }, ...changes };
}
it('preserves all rows and fields when no observations arrive', () => {
  const state = previous();
  expect(mergeScan(state, [], '2026-09-09')).toMatchObject({ state, changes: [] });
});
it('appends price history and preserves legacy data without mutating input', () => {
  const state = previous(), before = structuredClone(state);
  const result = mergeScan(state, [observation()], '2026-09-09');
  expect(result.state.listings).toHaveLength(1);
  expect(result.state.listings[0]).toMatchObject({ id: state.listings[0].id, price: 355000, conversionEstimate: 62000 });
  expect(result.state.listings[0].history.map(entry => entry.price)).toEqual([365000, 355000]);
  expect(result.state.listings[0].evidence[0]).toEqual(state.listings[0].evidence[0]);
  expect(state).toEqual(before);
});
it('does not duplicate evidence or history when replaying a run', () => {
  const result = mergeScan(previous(), [observation(), observation()], '2026-09-09');
  const replay = mergeScan(result.state, [observation()], '2026-09-09');
  expect(replay.state).toEqual(result.state);
  expect(replay.changes).toEqual([]);
});
it('records source failures without losing properties', () => {
  const state = previous();
  expect(mergeScan(state, [], '2026-09-09', { sourceFailures: ['Homes.com: HTTP 403'] }))
    .toMatchObject({ state, diagnostics: ['Homes.com: HTTP 403'] });
});
it('preserves the previous price when sources disagree and retains both observations', () => {
  const first = observation(), second = observation();
  second.candidate.price = 345000; second.candidate.sourceUrl = 'https://other.example/property';
  const result = mergeScan(previous(), [first, second], '2026-09-09');
  expect(result.state.listings[0].price).toBe(365000);
  expect(result.state.listings[0].history).toHaveLength(1);
  expect(result.state.listings[0].evidence.filter(item => item.kind === 'listing')).toHaveLength(2);
  expect(result.diagnostics.join(' ')).toContain('Conflicting price');
});
it('adds unknown narrow records but requires verified eligible parcels for wide additions', () => {
  const narrow = observation(); narrow.candidate.address = '100 Main St N';
  const wide = structuredClone(narrow); wide.mode = 'wide';
  expect(mergeScan(previous(), [narrow], '2026-09-09').state.listings[1].lifecycle).toBe('needs_verification');
  expect(mergeScan(previous(), [wide], '2026-09-09').state.listings).toHaveLength(1);
  wide.parcel = { adu: 'yes', criteria: 'Meets criteria for ADU', matchedAddress: '100  MAIN ST N',
    ambiguous: false, checkedAt: '2026-09-09', url: 'https://services2.arcgis.com/query', reason: 'Exact reason' };
  expect(mergeScan(previous(), [wide], '2026-09-09').state.listings).toHaveLength(2);
  wide.parcel.checkedAt = '2026-01-01';
  expect(mergeScan(previous(), [wide], '2026-09-09').state.listings).toHaveLength(1);
});
it('never clears eligibility after failed parcel lookup', () => {
  const result = mergeScan(previous(), [observation({ parcel: { adu: 'unknown', ambiguous: false, checkedAt: '2026-09-09', error: 'Timeout' } })], '2026-09-09');
  expect(result.state.listings[0].adu).toBe('yes');
  expect(result.diagnostics.join(' ')).toContain('Timeout');
});
it('requires a cited explicit confirmation to mark gone', () => {
  const uncited = mergeScan(previous(), [observation({ statusConfirmation: 'gone' })], '2026-09-09');
  expect(uncited.state.listings[0].lifecycle).toBe('active');
  const cited = mergeScan(previous(), [observation({ statusConfirmation: 'gone', statusSourceUrl: 'https://example.org/listing' })], '2026-09-09');
  expect(cited.state.listings[0].lifecycle).toBe('gone');
  expect(cited.state.listings[0].history.at(-1)?.lifecycle).toBe('gone');
  expect(rankListings(cited.state.listings)).toHaveLength(0);
});
it('keeps under-contract records from being reactivated by index presence', () => {
  const state = previous(); state.listings[0].lifecycle = 'under_contract';
  expect(mergeScan(state, [observation()], '2026-09-09').state.listings[0].lifecycle).toBe('under_contract');
});
it('ignores stale price observations', () => {
  const old = observation(); old.candidate.fetchedAt = '2026-09-01';
  expect(mergeScan(previous(), [old], '2026-09-09').state).toEqual(previous());
});
it('does not conflate north and south addresses', () => {
  const south = observation(); south.candidate.address = '4219 5th Ave S';
  expect(mergeScan(previous(), [south], '2026-09-09').state.listings).toHaveLength(2);
});
it('does not revive a property ruled out for a permanent constraint', () => {
  const state = previous(); state.listings[0].lifecycle = 'ruled_out';
  const result = mergeScan(state, [observation({ statusConfirmation: 'active', statusSourceUrl: 'https://example.org/listing' })], '2026-09-09');
  expect(result.state.listings[0].lifecycle).toBe('ruled_out');
});
it('does not apply stale City evidence to a fresh listing observation', () => {
  const item = observation({ parcel: { adu: 'no', criteria: 'Does not meet criteria', matchedAddress: '4219 5th Ave N',
    ambiguous: false, checkedAt: '2026-01-01', url: 'https://services2.arcgis.com/query' } });
  expect(mergeScan(previous(), [item], '2026-09-09').state.listings[0].adu).toBe('yes');
});
it('reports no deltas and keeps price history for an unchanged price observation', () => {
  const item = observation(); item.candidate.price = 365000;
  const result = mergeScan(previous(), [item], '2026-09-09');
  expect(result.changes).toEqual([]);
  expect(result.state.listings[0].history).toEqual(previous().listings[0].history);
});
