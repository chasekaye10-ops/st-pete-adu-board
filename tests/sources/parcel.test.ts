import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { lookupParcel, mapCriteria, selfTestParcelApi } from '../../src/sources/parcel.js';
import type { Fetcher } from '../../src/sources/http.js';
const fixture = JSON.parse(readFileSync(new URL('../fixtures/parcel-self-test.json', import.meta.url), 'utf8'));
const fetcher = (data: unknown): Fetcher => async () => ({ ok: true, data });
it.each([['Meets criteria for ADU','yes'],['Does not meet criteria','no'],['Contact city staff','staff'],[null,'unknown'],['Unrecognized','unknown']])('maps verdict %s', (input, expected) => {
  expect(mapCriteria(input)).toBe(expected);
});
it('matches double spaces, contracts street types and preserves reason', async () => {
  const result = await lookupParcel('1521 12th Street S', fetcher(fixture));
  expect(result).toMatchObject({ adu: 'yes', reason: 'Fixture reason preserved verbatim. ', lotSf: 6225 });
});
it('ignores ordinal collisions and other directions', async () => {
  const wrong = { attributes: { ...fixture.features[0].attributes, ADDRESS: '1521 112TH ST N', CRITERIA: 'Does not meet criteria' } };
  expect(await lookupParcel('1521 12th St S', fetcher({ features: [wrong, ...fixture.features] }))).toMatchObject({ adu: 'yes', ambiguous: false });
});
it('does not accept a single wrong address', async () => {
  expect(await lookupParcel('1521 12th St N', fetcher(fixture))).toMatchObject({ adu: 'unknown' });
});
it('rejects duplicate exact matches as ambiguous', async () => {
  expect(await lookupParcel('1521 12th St S', fetcher({ features: [...fixture.features, ...fixture.features] }))).toMatchObject({ adu: 'unknown', ambiguous: true });
});
it('represents zero area as zoning qualification', async () => {
  const data = structuredClone(fixture); data.features[0].attributes.SQFT = 0;
  expect(await lookupParcel('1521 12th St S', fetcher(data))).toMatchObject({ lotSf: null, areaNote: 'Qualifies by zoning; lot area not applicable' });
});
it('rejects overlong URLs before fetching', async () => {
  let called = false;
  const result = await lookupParcel('1521 ' + 'A'.repeat(200), async () => { called = true; return { ok: true, data: fixture }; });
  expect(called).toBe(false); expect(result.adu).toBe('unknown');
});
it('requires the full schema and known-good parcel to pass self-test', async () => {
  const schema = { fields: ['ADDRESS','ZONING','NTCRIT','SQFT','CRITERIA'].map(name => ({ name })) };
  expect(await selfTestParcelApi(async url => ({ ok: true, data: url.includes('/query?') ? fixture : schema }))).toMatchObject({ ok: true });
  expect(await selfTestParcelApi(fetcher({ fields: [] }))).toMatchObject({ ok: false });
});
it.each([{ error: { message: 'Unavailable' } }, { features: [{ attributes: {} }] }, { features: fixture.features, exceededTransferLimit: true }])('fails closed on invalid or partial responses', async data => {
  expect(await lookupParcel('1521 12th St S', fetcher(data))).toMatchObject({ adu: 'unknown' });
});
