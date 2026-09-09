import { expect, it } from 'vitest';
import { analyzeListing } from '../../src/analysis/listing-analysis.js';
const input = { sourceUrl: 'https://example.org/property', snippet: 'Attached garage. Block construction.', capturedAt: '2026-09-08' };
const facts = { convertibleStatus: 'found', convertibleDetail: 'Attached garage', construction: 'block',
  flood: 'unknown', listingStatus: 'unknown', confidence: 'medium', evidenceQuote: input.snippet };
it('retains original URL and source text with validated evidence', async () => {
  expect(await analyzeListing(input, { extract: async () => facts })).toMatchObject({ ...facts, ...input, failure: null });
});
it('continues with unknown evidence when the model is unavailable', async () => {
  expect(await analyzeListing(input, null)).toMatchObject({ convertibleStatus: 'unknown', failure: expect.any(String) });
});
it.each([{ ...facts, evidenceQuote: '' }, { ...facts, evidenceQuote: 'Invented quote' },
  { ...facts, extra: 'unexpected' }, { ...facts, construction: 'magic' }])('rejects unsupported model output', async response => {
  expect(await analyzeListing(input, { extract: async () => response })).toMatchObject({ convertibleStatus: 'unknown', failure: expect.any(String) });
});
it('records model failures without throwing away the scan', async () => {
  expect(await analyzeListing(input, { extract: async () => { throw new Error('Rate limited'); } }))
    .toMatchObject({ failure: 'Rate limited', convertibleStatus: 'unknown' });
});
