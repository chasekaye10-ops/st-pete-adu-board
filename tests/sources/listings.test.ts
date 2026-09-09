import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { approvedSources, fetchCandidates } from '../../src/sources/listings.js';
const html = readFileSync(new URL('../fixtures/listing-card.html', import.meta.url), 'utf8');
it('extracts Trulia native records with explicit single-family type and active status', async () => {
  const fixture = readFileSync(new URL('../fixtures/trulia-card.html', import.meta.url), 'utf8');
  const sweep = await fetchCandidates('narrow', async url => url.includes('trulia')
    ? { ok: true, data: fixture } : { ok: false, error: 'Unavailable' });
  expect(sweep.candidates[0]).toMatchObject({ address: '3920 5TH AVENUE N', price: 349000, houseSf: 884 });
});
it('allows missing bedroom counts without discarding the source', async () => {
  const fixture = readFileSync(new URL('../fixtures/trulia-card.html', import.meta.url), 'utf8').replace('"bedrooms":{"value":2}', '"bedrooms":{}');
  const sweep = await fetchCandidates('narrow', async url => url.includes('trulia') ? { ok: true, data: fixture } : { ok: false, error: 'Unavailable' });
  expect(sweep.candidates[0].bedsBaths).toBe('?/1');
});
it('reports missing Trulia pages while retaining usable records', async () => {
  const fixture = readFileSync(new URL('../fixtures/trulia-card.html', import.meta.url), 'utf8').replace('"agentListingsCount":{"value":1}', '"agentListingsCount":{"value":46}');
  const sweep = await fetchCandidates('narrow', async url => url.includes('trulia') ? { ok: true, data: fixture } : { ok: false, error: 'Unavailable' });
  expect(sweep.candidates.length).toBeGreaterThan(0);
  expect(sweep.sources[0].failure).toContain('Pagination incomplete');
});
it('follows observed Trulia numbered links and totals pages before declaring incomplete', async () => {
  const fixture = readFileSync(new URL('../fixtures/trulia-card.html', import.meta.url), 'utf8').replace('"agentListingsCount":{"value":1}', '"agentListingsCount":{"value":2}');
  const root = approvedSources.narrow[0].url;
  const sweep = await fetchCandidates('narrow', async url => url.startsWith(root)
    ? { ok: true, data: fixture + (url === root ? `<a href="${root}2_p/">2</a>` : '') }
    : { ok: false, error: 'Unavailable' });
  expect(sweep.sources[0]).toMatchObject({ pagesFetched: 2, failure: null });
});
it('extracts parent offers from the real Coldwell Banker record structure', async () => {
  const coldwell = readFileSync(new URL('../fixtures/coldwell-card.html', import.meta.url), 'utf8');
  const sweep = await fetchCandidates('narrow', async url => url.includes('coldwellbankerhomes')
    ? { ok: true, data: coldwell } : { ok: false, error: 'Fixture source unavailable' });
  expect(sweep.candidates).toHaveLength(1);
  expect(sweep.candidates[0]).toMatchObject({ address: '2329 15th Ave S', price: 225000, houseSf: 780, bedsBaths: '2/1' });
});
it('extracts a single-family listing with price and source text', async () => {
  const sweep = await fetchCandidates('narrow', async () => ({ ok: true, data: html }));
  expect(sweep.candidates[0]).toMatchObject({ address: '4219 5th Ave N', price: 365000,
    houseSf: 1950, propertyType: 'single_family', snippet: 'Attached two-car garage. Block construction.' });
  expect(sweep.sources).toHaveLength(7);
});
it.each([
  ['365000', '500000'], ['SingleFamilyResidence', 'Apartment'],
  ['Saint Petersburg', 'Gulfport'], ['1950', '0'], ['USD', 'CAD'],
])('excludes candidates outside criteria: %s', async (from, to) => {
  expect((await fetchCandidates('narrow', async () => ({ ok: true, data: html.replace(from, to) }))).candidates).toHaveLength(0);
});
it.each(['<title>Access Denied</title>', '<title>Request Rejected</title>', '<html>Unrecognized content</html>'])('reports unusable pages as failures', async data => {
  const sweep = await fetchCandidates('narrow', async () => ({ ok: true, data }));
  expect(sweep.candidates).toHaveLength(0);
  expect(sweep.sources.every(source => source.failure !== null)).toBe(true);
});
it('isolates a failed source from successful ones', async () => {
  const sweep = await fetchCandidates('narrow', async url => {
    if (url.includes('trulia')) throw new Error('Offline');
    return { ok: true, data: html };
  });
  expect(sweep.candidates.length).toBeGreaterThan(0);
  expect(sweep.sources.filter(source => source.failure)).toHaveLength(3);
});
it('follows scoped next links and reports page limits', async () => {
  const seen: string[] = [];
  const sweep = await fetchCandidates('narrow', async url => {
    seen.push(url);
    return { ok: true, data: html + '<a rel="next" href="?page=2">Next</a>' };
  });
  expect(seen.some(url => url.includes('page=2'))).toBe(true);
  expect(sweep.sources.every(source => source.failure?.includes('Pagination'))).toBe(true);
});
it('does not follow off-site or out-of-scope pagination', async () => {
  const seen: string[] = [];
  await fetchCandidates('narrow', async url => { seen.push(url); return { ok: true,
    data: html + '<a rel="next" href="https://example.org/">Next</a>' }; });
  expect(seen).toHaveLength(7);
});
it('retains different source prices for later conflict-aware merging', async () => {
  const sweep = await fetchCandidates('narrow', async url => ({ ok: true,
    data: url.includes('trulia') ? html : html.replace('365000', '355000') }));
  expect(new Set(sweep.candidates.map(candidate => candidate.price))).toEqual(new Set([365000, 355000]));
});
it('uses only the approved wide source set without automatic widening', () => {
  expect(approvedSources.wide).toHaveLength(6);
  expect(approvedSources.narrow.some(source => /redfin|bexrealty/.test(source.url))).toBe(false);
});
