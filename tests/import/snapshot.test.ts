import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { validateState } from '../../src/domain/state.js';
import { importLegacy, parseLegacyRows } from '../../src/import/legacy.js';

it('preserves all 112 imported properties and reproduces the snapshot from archived rows', () => {
  const current = validateState(JSON.parse(readFileSync(new URL('../../data/state.json', import.meta.url), 'utf8')));
  // Check the preserved migration baseline even after live prices and inventory evolve.
  const rows = parseLegacyRows(current.listings.flatMap(row => row.evidence
    .filter(item => item.kind === 'legacyNote' && item.legacyNote)
    .map(item => item.legacyNote)));
  const state = importLegacy(rows, current.importedAt);
  expect(state.listings).toHaveLength(112);
  expect(new Set(state.listings.map(row => row.id)).size).toBe(112);
  expect(state.listings.map(row => row.address)).toEqual(expect.arrayContaining([
    '2901 Dr ML King Jr St S', '4728 9th Ave N', '3940 Burlington Ave N', '4219 5th Ave N',
  ]));
  expect(validateState(state)).toEqual(state);
  expect(state.listings.find(row => row.address === '4728 9th Ave N')).toMatchObject({
    lifecycle: 'under_contract', conversionEstimate: 50000, achievableAdu: 500,
  });
  expect(state.listings.find(row => row.address === '2901 Dr ML King Jr St S')).toMatchObject({
    lifecycle: 'ruled_out', adu: 'yes',
  });
});
