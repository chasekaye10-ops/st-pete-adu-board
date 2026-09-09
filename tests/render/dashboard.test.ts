import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
import { expect, it } from 'vitest';
import { renderDashboard } from '../../src/render/dashboard.js';
import { validateState } from '../../src/domain/state.js';
const state = () => validateState(JSON.parse(readFileSync('data/state.json', 'utf8')));
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
