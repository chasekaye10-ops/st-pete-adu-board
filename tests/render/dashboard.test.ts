import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
import { expect, it } from 'vitest';
import { renderDashboard } from '../../src/render/dashboard.js';
import { validateState } from '../../src/domain/state.js';
import { importLegacy, parseLegacyRows } from '../../src/import/legacy.js';
const liveState = () => validateState(JSON.parse(readFileSync('data/state.json', 'utf8')));
// Layout expectations describe the preserved import, not the changing daily inventory.
const state = () => {
  const current = liveState();
  const rows = parseLegacyRows(current.listings.flatMap(row => row.evidence
    .filter(item => item.kind === 'legacyNote' && item.legacyNote)
    .map(item => item.legacyNote)));
  return importLegacy(rows, current.importedAt);
};
it('leads with the buy candidate, then inventory, comps and archive', () => {
  const html = renderDashboard(state(), null);
  const $ = load(html);
  expect($('#buy-candidate').text()).toContain('4219 5th Ave N');
  expect(html.indexOf('BUY CANDIDATE')).toBeLessThan(html.indexOf('Full candidate board'));
  expect($('#inventory').text()).not.toContain('4728 9th Ave N');
  expect($('#comps').text()).toContain('4728 9th Ave N');
  expect($('#archive').text()).toContain('2901 Dr ML King Jr St S');
  expect($('#archive').text()).toContain('AE');
  expect($('[data-property]').length).toBe(112);
  expect(html).toContain('Imported snapshot');
});
it('renders every live property exactly once as inventory grows', () => {
  const current = liveState();
  const added = structuredClone(current.listings[0]);
  added.id = 'new-scan-regression';
  added.address = '123 Test Ave N';
  added.lifecycle = 'needs_verification';
  current.listings.push(added);
  const $ = load(renderDashboard(current, null));
  const renderedIds = $('[data-property]').map((_, el) => $(el).attr('id')).get();
  expect(renderedIds.sort()).toEqual(current.listings.map(row => `property-${row.id}`).sort());
  expect($('#inventory').text()).toContain(added.address);
});
it('does not publish raw private notes or unsafe links and escapes public text', () => {
  const s = state();
  s.listings[0].evidence.push({ kind: 'legacyNote', source: 'private', detail: 'PRIVATE_OFFER', capturedAt: '2026-09-08', legacyNote: { note: 'PRIVATE_OFFER' } });
  s.listings[0].address = '<img src=x onerror=alert(1)>';
  s.listings[0].sourceUrl = 'javascript:alert(1)';
  const html = renderDashboard(s, null);
  expect(html).not.toContain('PRIVATE_OFFER');
  expect(html).not.toContain('legacyNote');
  expect(html).not.toContain('javascript:');
  expect(html).toContain('&lt;img');
  expect(load(html)('img[onerror]').length).toBe(0);
});
it('keeps secret-like and contact data out of displayed fields', () => {
  const s = state();
  s.listings[0].convertibleSpace = 'Contact person@example.com sk-abcdefghijklmnopqrstuvwxyz123456';
  const html = renderDashboard(s, null);
  expect(html).not.toContain('person@example.com');
  expect(html).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
});
it('provides labels, filters and an honest empty state', () => {
  const s = state(); s.listings = [];
  const html = renderDashboard(s, null);
  const $ = load(html);
  expect(html).toContain('No active candidate');
  expect($('label[for="search"]').length).toBe(1);
  expect($('[aria-live="polite"]').length).toBeGreaterThan(0);
});

function recordedCandidate() {
  const s = state();
  s.listings = [structuredClone(s.listings.find(row => row.address === '4219 5th Ave N')!)];
  s.listings[0].evidence = s.listings[0].evidence.filter(item => item.source === 'legacy-board-export');
  s.listings[0].updatedAt = s.importedAt;
  return s;
}
function report(overrides: Partial<import('../../src/scan/run.js').DailyRun> = {}): import('../../src/scan/run.js').DailyRun {
  return { date: '2026-09-24', startedAt: '2026-09-24T10:00:00Z', completedAt: '2026-09-24T10:01:00Z',
    mode: 'narrow', gateReason: 'Test', dryRun: false, parcelSelfTest: { ok: true, passed: true },
    sources: [], queriedAddresses: 0, matchedAddresses: 0, newEligibleNarrow: 0,
    changes: [], failures: [], stateChanged: false, delistingEvaluated: false, ...overrides };
}
it.each([
  { adu: 'unknown' }, { lifecycle: 'needs_verification' }, { lifecycle: 'under_contract' },
  { price: 437001 }, { conversionStructure: '' }, { conversionStructure: 'assumed garage' },
  { conversionStructure: 'unverified garage' }, { conversionStructure: 'unknown' },
  { conversionStructure: 'confirmed' }, { conversionStructure: 'possible garage' },
] as const)('does not recommend an unsafe candidate: %j', patch => {
  const s = recordedCandidate(); Object.assign(s.listings[0], patch);
  expect(load(renderDashboard(s, null))('#buy-candidate h2').text()).not.toBe(s.listings[0].address);
});
it.each(['unknown', 'Zone AE', 'Zone X, per listing'])('does not recommend flood evidence %s', detail => {
  const s = recordedCandidate();
  s.listings[0].evidence = [{ kind: 'flood', source: 'legacy-board-export', capturedAt: s.importedAt, detail }];
  expect(load(renderDashboard(s, null))('#buy-candidate h2').text()).not.toBe(s.listings[0].address);
});
it.each([null, report(), report({ dryRun: true }), report({ failures: ['State persistence: failed'] }),
  report({ parcelSelfTest: { ok: false, passed: false }, failures: ['Parcel self-test: failed'] })])
('keeps recorded evidence dates and availability caveat independent of scan outcome', run => {
  const s = recordedCandidate(), html = renderDashboard(s, run), $ = load(html);
  expect($('#buy-candidate h2').text()).toBe(s.listings[0].address);
  expect($('#buy-candidate').text()).toContain('Current availability unverified');
  expect($('#buy-candidate').text()).toContain('Recorded evidence');
  expect($('#property-list').text()).toContain(s.importedAt.slice(0, 10));
  expect($('#property-list').text()).not.toContain('2026-09-24');
  expect(html).not.toContain('Data as of');
  expect($('.snapshot').text()).toContain('Last scan');
  if (run) expect($('.snapshot').text()).toContain('2026-09-24');
});
it('renders every run failure as escaped diagnostic text even without source results', () => {
  const failures = ['narrow sources: offline', 'State persistence: failed', 'Conflicting price',
    '<img src=x onerror=alert(1)>'];
  const $ = load(renderDashboard(recordedCandidate(), report({ failures })));
  expect($('#run-failures li').map((_, el) => $(el).text()).get()).toEqual(failures);
  expect($('#run-failures img').length).toBe(0);
});
