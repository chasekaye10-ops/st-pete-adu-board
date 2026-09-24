import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isSixAmEastern } from '../../scripts/is-six-am-et.mjs';

function runsDirectory(t) {
  const runsDir = mkdtempSync(join(tmpdir(), 'adu-schedule-'));
  t.after(() => rmSync(runsDir, { recursive: true, force: true }));
  return runsDir;
}

test('due at 6 AM in summer, winter and both DST transitions', (t) => {
  const runsDir = runsDirectory(t);
  for (const date of ['2026-07-01T10:00:00Z', '2026-01-01T11:00:00Z', '2026-03-08T10:00:00Z', '2026-11-01T11:00:00Z']) {
    assert.equal(isSixAmEastern(new Date(date), { runsDir }), true, date);
  }
});

test('due when delayed past 6 AM, including after 9 AM and late evening', (t) => {
  const runsDir = runsDirectory(t);
  for (const date of ['2026-07-01T11:00:00Z', '2026-07-01T13:30:00Z', '2026-01-01T14:30:00Z', '2026-03-08T13:30:00Z', '2026-11-01T14:30:00Z', '2026-07-02T03:59:59Z']) {
    assert.equal(isSixAmEastern(new Date(date), { runsDir }), true, date);
  }
});

test('not due before 6 AM, including midnight and DST transitions', (t) => {
  const runsDir = runsDirectory(t);
  for (const date of ['2026-07-01T09:59:59Z', '2026-01-01T10:59:59Z', '2026-03-08T09:59:59Z', '2026-11-01T10:59:59Z', '2026-07-02T04:00:00Z']) {
    assert.equal(isSixAmEastern(new Date(date), { runsDir }), false, date);
  }
});

test('completed Eastern date skips both cron attempts and delayed runs, not the next day', (t) => {
  const runsDir = runsDirectory(t);
  writeFileSync(join(runsDir, '2026-07-01.json'), '{}');
  for (const date of ['2026-07-01T10:00:00Z', '2026-07-01T11:00:00Z', '2026-07-01T13:30:00Z', '2026-07-02T03:59:59Z']) {
    assert.equal(isSixAmEastern(new Date(date), { runsDir }), false, date);
  }
  assert.equal(isSixAmEastern(new Date('2026-07-02T10:00:00Z'), { runsDir }), true);
});

test('manual runs bypass the hour gate but never the completed-date gate', (t) => {
  const runsDir = runsDirectory(t);
  const options = { runsDir, manual: true };
  assert.equal(isSixAmEastern(new Date('2026-01-01T10:00:00Z'), options), true);
  writeFileSync(join(runsDir, '2026-01-01.json'), '{}');
  for (const date of ['2026-01-01T10:00:00Z', '2026-01-01T11:00:00Z', '2026-01-01T15:00:00Z']) {
    assert.equal(isSixAmEastern(new Date(date), options), false, date);
  }
});
