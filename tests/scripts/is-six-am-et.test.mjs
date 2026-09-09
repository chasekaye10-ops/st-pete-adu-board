import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSixAmEastern } from '../../scripts/is-six-am-et.mjs';
test('handles summer, winter and DST transition dates', () => {
  for (const date of ['2026-07-01T10:00:00Z', '2026-01-01T11:00:00Z', '2026-03-08T10:00:00Z', '2026-11-01T11:00:00Z']) assert.equal(isSixAmEastern(new Date(date)), true);
  for (const date of ['2026-01-01T10:00:00Z', '2026-07-01T11:00:00Z', '2026-03-08T11:00:00Z', '2026-11-01T10:00:00Z']) assert.equal(isSixAmEastern(new Date(date)), false);
});
