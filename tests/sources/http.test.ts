import { expect, it } from 'vitest';
import { createFetcher, createTextFetcher } from '../../src/sources/http.js';

it('returns HTML unchanged for listing adapters', async () => {
  expect(await createTextFetcher(async () => new Response('<html>Listings</html>'))('https://example.test'))
    .toEqual({ ok: true, data: '<html>Listings</html>' });
});

it('decodes JSON responses', async () => {
  const fetcher = createFetcher(async () => new Response('{"value":42}'));
  expect(await fetcher('https://example.test')).toEqual({ ok: true, data: { value: 42 } });
});
it.each([
  [() => new Response('unavailable', { status: 503 }), 'HTTP 503'],
  [() => new Response('not json'), ''],
] as [() => Response, string][])('reports failed HTTP or invalid JSON', async (response, error) => {
  expect(await createFetcher(async () => response())('https://example.test')).toMatchObject({ ok: false, error: expect.stringContaining(error) });
});
it('limits actual streamed bytes without relying on Content-Length', async () => {
  expect(await createFetcher(async () => new Response('123456'), 1000, 5)('https://example.test'))
    .toEqual({ ok: false, error: 'Response exceeds 5 bytes' });
});
it('times out a hanging request', async () => {
  expect(await createFetcher(() => new Promise<Response>(() => {}), 10)('https://example.test'))
    .toEqual({ ok: false, error: 'Timeout after 10ms' });
});
it('times out a hanging response body', async () => {
  expect(await createFetcher(async () => new Response(new ReadableStream()), 10)('https://example.test'))
    .toEqual({ ok: false, error: 'Timeout after 10ms' });
});
