import { expect, it } from 'vitest';
import { importLegacy } from '../../src/import/legacy.js';
import { runDailyScan, type ScanDependencies, type DailyRun } from '../../src/scan/run.js';
import type { BoardState } from '../../src/domain/types.js';
import type { ListingCandidate } from '../../src/sources/listings.js';

const now = new Date('2026-09-09T10:00:00Z');
function candidate(address = '4219 5TH AVENUE N'): ListingCandidate {
  return { address, price: 355000, houseSf: 1950, bedsBaths: '3/2', maxAdu: 800,
    propertyType: 'single_family', source: 'Fixture', sourceUrl: 'https://example.org/' + encodeURIComponent(address),
    indexUrl: 'https://example.org/', fetchedAt: now.toISOString(), snippet: 'Attached garage' };
}
function setup() {
  let state: BoardState = importLegacy([{ a: '4219 5th Ave N', p: 365000, sf: 1950, bd: '3/2', t: 'strong' }], '2026-09-08');
  let report: DailyRun | undefined;
  const modes: string[] = [];
  const deps: ScanDependencies = {
    loadState: async () => structuredClone(state),
    selfTest: async () => ({ ok: true }),
    fetchCandidates: async mode => { modes.push(mode); return { mode, candidates: mode === 'narrow' ? [candidate()] : [], sources: [], truncated: false }; },
    lookupParcel: async address => ({ adu: 'yes', ambiguous: false, matchedAddress: address,
      criteria: 'Meets criteria for ADU', checkedAt: now.toISOString(), url: 'https://services2.arcgis.com/query' }),
    analyze: async input => ({ ...input, convertibleStatus: 'unknown', convertibleDetail: '', construction: 'unknown', flood: 'unknown',
      listingStatus: 'unknown', confidence: 'low', evidenceQuote: '', failure: 'No API key' }),
    writeState: async next => { state = structuredClone(next); },
    writeRun: async run => { report = run; }, now: () => now,
  };
  return { deps, modes, state: () => state, report: () => report };
}
it('preserves state and writes a diagnostic report when the parcel gate fails', async () => {
  const test = setup(), before = structuredClone(test.state());
  test.deps.selfTest = async () => ({ ok: false, error: 'Endpoint unavailable' });
  test.deps.lookupParcel = async () => { throw new Error('Must not run'); };
  const run = await runDailyScan(test.deps, now);
  expect(run.parcelSelfTest.passed).toBe(false);
  expect(run.stateChanged).toBe(false);
  expect(test.state()).toEqual(before);
  expect(test.report()).toEqual(run);
  expect(test.modes).toEqual(['narrow']);
});
it('widens when fewer than three new eligible addresses are found, then records a price change', async () => {
  const test = setup();
  const run = await runDailyScan(test.deps, now);
  expect(test.modes).toEqual(['narrow', 'wide']);
  expect(run).toMatchObject({ mode: 'wide', stateChanged: true, queriedAddresses: 1, matchedAddresses: 1 });
  expect(test.state().listings[0].price).toBe(355000);
  expect(run.changes.some(change => change.field === 'price')).toBe(true);
});
it('does not widen when three distinct new eligible properties are found', async () => {
  const test = setup();
  test.deps.fetchCandidates = async mode => { test.modes.push(mode); return { mode,
    candidates: ['1 First St N', '2 First St N', '3 First St N'].map(candidate), sources: [], truncated: false }; };
  expect((await runDailyScan(test.deps, now)).mode).toBe('narrow');
  expect(test.modes).toEqual(['narrow']);
});
it('records ordinary source failures and keeps prior listings', async () => {
  const test = setup();
  test.deps.fetchCandidates = async () => { throw new Error('Source offline'); };
  const before = structuredClone(test.state());
  const run = await runDailyScan(test.deps, now);
  expect(run.failures.join(' ')).toContain('Source offline');
  expect(test.state()).toEqual(before);
});
it('preview reports proposed changes without writing state', async () => {
  const test = setup(); test.deps.dryRun = true;
  const before = structuredClone(test.state());
  const run = await runDailyScan(test.deps, now);
  expect(run).toMatchObject({ dryRun: true, stateChanged: false });
  expect(run.changes.length).toBeGreaterThan(0);
  expect(test.state()).toEqual(before);
});
it('restores previous state if the run report cannot be saved', async () => {
  const test = setup(), before = structuredClone(test.state());
  test.deps.writeRun = async () => { throw new Error('Disk full'); };
  await expect(runDailyScan(test.deps, now)).rejects.toThrow('Disk full');
  expect(test.state()).toEqual(before);
});
it('records failed state persistence as unchanged', async () => {
  const test = setup();
  test.deps.writeState = async () => { throw new Error('State write failed'); };
  const run = await runDailyScan(test.deps, now);
  expect(run.stateChanged).toBe(false);
  expect(run.failures.join(' ')).toContain('State write failed');
});
