import type { BoardState, Listing } from '../domain/types.js';
import type { DailyRun } from '../scan/run.js';
import { calculateAnnualCarry, isVerifiedFloodX, rankListings } from '../domain/calculations.js';
import { styles, interactions } from './presentation.js';

function publicText(value: unknown): string {
  return String(value ?? '').replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[redacted]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[contact omitted]')
    .replace(/(?:\+1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/g, '[contact omitted]');
}
const escape = (value: unknown) => publicText(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
const status = { active: 'Active', under_contract: 'Under contract', needs_verification: 'Needs verification', ruled_out: 'Ruled out', gone: 'Off market / sold' };
const aduLabel = { yes: 'Eligible', no: 'Not eligible', staff: 'City confirmation', unknown: 'Not checked' };
function link(url: string | undefined, label: string): string {
  try {
    const parsed = new URL(url ?? '');
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return '';
    if (/token|key|secret|password/i.test(parsed.search)) return '';
    return `<a href="${escape(parsed.href)}" target="_blank" rel="noopener noreferrer">${escape(label)} <span aria-hidden="true">↗</span></a>`;
  } catch { return ''; }
}
function floodText(row: Listing): string {
  const entries = row.evidence.filter(item => item.kind === 'flood');
  return entries.length ? entries.map(item => item.detail).join(' / ') : 'Unknown · map check needed';
}
function nextAction(row: Listing): string {
  if (row.adu !== 'yes') return 'Confirm eligibility with the City';
  if (!isVerifiedFloodX(row)) return 'Verify the flood map';
  if (!row.achievableAdu) return 'Measure the conversion space';
  return 'Tour and price the renovation';
}
function safeParcel(row: Listing): string {
  const evidence = [...row.evidence].reverse().find(item => item.kind === 'parcel');
  if (!evidence) return `<p class="muted">Eligibility inherited from the imported board. A fresh City check is still needed.</p>`;
  try {
    const parcel = JSON.parse(evidence.detail);
    return `<p>${escape(parcel.reason ?? 'No City explanation supplied')}</p><p class="muted">${escape(parcel.checkedAt)} ${link(evidence.sourceUrl, 'City response')}</p>`;
  } catch { return '<p class="muted">City response unavailable.</p>'; }
}
function details(row: Listing): string {
  const urls = [...new Set([row.sourceUrl, ...row.evidence.filter(item => item.kind === 'listing').map(item => item.sourceUrl)].filter((url): url is string => !!url))];
  return `<details class="evidence"><summary>Evidence &amp; price history</summary><div class="evidence-body">
    <div><h4>City eligibility</h4>${safeParcel(row)}</div><div><h4>Flood evidence</h4><p>${escape(floodText(row))}</p></div>
    <div><h4>Conversion</h4><p>${escape(row.convertibleSpace || row.conversionStructure || 'Existing convertible space is unverified.')}</p>
    <p class="muted">Conversion estimate: ${row.conversionEstimate ? money(row.conversionEstimate) : 'Unknown'}. Renovation costs may be additional.</p></div>
    <div><h4>Recorded history</h4><ol>${row.history.filter(entry => entry.price !== undefined || entry.lifecycle).map(entry => `<li>${escape(entry.at.slice(0,10))} · ${entry.price !== undefined ? money(entry.price) : ''} ${entry.lifecycle ? escape(status[entry.lifecycle]) : ''}</li>`).join('')}</ol>
    ${urls.map(url => link(url, 'Listing source')).join(' · ') || '<p class="muted">No listing link preserved in the original export.</p>'}</div></div></details>`;
}
function property(row: Listing, position: number): string {
  return `<article class="property" id="property-${escape(row.id)}" data-property data-address="${escape(row.address.toLowerCase())}" data-status="${row.lifecycle}" data-price="${row.price}" data-adu="${row.maxAdu}" data-flood="${isVerifiedFloodX(row)}" data-rank="${position}">
    <div class="property-main"><span class="position">${String(position + 1).padStart(2, '0')}</span><div class="address"><h3>${escape(row.address)}</h3><p>${escape(row.bedsBaths)} beds/baths · ${row.houseSf.toLocaleString('en-US')} sf house · ${escape(row.zoning || 'Zoning unknown')}</p>
    <span class="pill ${row.lifecycle === 'active' ? 'green' : ''}">${status[row.lifecycle]}</span> <span class="pill">${aduLabel[row.adu]}</span></div>
    <div class="figure"><strong>${money(row.price)}</strong><small>Asking price</small></div><div class="figure"><strong>${row.maxAdu} <em>sf</em></strong><small>Legal ADU ceiling</small></div>
    <div class="figure"><strong>${row.achievableAdu ? `${row.achievableAdu} <em>sf</em>` : 'Unknown'}</strong><small>Conversion footprint</small></div></div>
    <div class="property-context"><span>${isVerifiedFloodX(row) ? 'Zone X · property record' : 'Flood evidence needs review'}</span><span>${escape(row.conversionStructure || 'Structure not confirmed')}</span><span>${money(calculateAnnualCarry(row.price))}/yr estimated carry</span></div>${details(row)}</article>`;
}

export function renderDashboard(state: BoardState, run: DailyRun | null, scheduled = false): string {
  const ranked = rankListings(state.listings);
  const best = ranked.find(row => row.adu === 'yes');
  const pending = state.listings.filter(row => row.lifecycle === 'needs_verification');
  const comps = state.listings.filter(row => row.lifecycle === 'under_contract');
  const archive = state.listings.filter(row => ['ruled_out', 'gone'].includes(row.lifecycle));
  const inventory = [...ranked, ...pending];
  const snapshot = !run;
  const reportDate = run?.completedAt ?? state.importedAt;
  const sources = run?.sources.flatMap(sweep => sweep.sources) ?? [];
  const sourceFailures = sources.filter(source => source.failure).length;
  const changes = run?.changes ?? [];
  const additions = changes.filter(change => change.field === 'added').length;
  const priceChanges = changes.filter(change => change.field === 'price');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="description" content="St. Petersburg property research: ADU candidates, conversion space and source evidence.">
    <title>St. Pete ADU Board</title><style>${styles}</style></head><body><a class="skip" href="#inventory">Skip to candidate board</a>
    <header><a class="brand" href="#"><span class="brand-mark">SP</span><span>ST. PETE<span class="brand-sub">ADU FIELD BOARD</span></span></a>
    <nav aria-label="Main navigation"><a href="#inventory">Candidates</a><a href="#comps">Comps</a><a href="#diagnostics">Scan status</a></nav><span class="schedule">${scheduled ? 'Daily · 6 AM Eastern' : 'Manual updates'}</span></header>
    <main><section class="intro"><div><p class="eyebrow">A HOUSE TO LIVE IN. ROOM TO BUILD.</p><h1>The next move.</h1></div><div class="snapshot"><span class="status-dot"></span><strong>${snapshot ? 'Imported snapshot' : run.dryRun ? 'Preview only' : run.failures.length ? 'Scan completed with gaps' : 'Scan completed'}</strong><br><span>Data as of ${escape(reportDate.slice(0,10))}${snapshot ? ' · not live-verified' : ''}</span></div></section>
    <section class="stats" aria-label="Board totals"><div><strong>${ranked.length}</strong><span>active candidates</span></div><div><strong>${pending.length}</strong><span>need verification</span></div><div><strong>${snapshot ? '—' : additions}</strong><span>new this scan</span></div><div><strong>${snapshot ? '—' : priceChanges.length}</strong><span>price changes</span></div></section>
    <div class="decision-layout"><section id="buy-candidate" class="candidate"><div class="candidate-top"><p class="eyebrow">BUY CANDIDATE</p><span>01 / ${String(ranked.length).padStart(2,'0')}</span></div>
      ${best ? `<h2>${escape(best.address)}</h2><p class="candidate-price">${money(best.price)} <span>asking · ${escape(best.bedsBaths)} beds/baths</span></p>
      <div class="candidate-facts"><div><strong>${best.maxAdu}<span>sf</span></strong><p>Legal ceiling</p></div><div><strong>${best.achievableAdu ?? '?'}<span>sf</span></strong><p>Achievable estimate</p></div><div><strong>${isVerifiedFloodX(best) ? 'X' : '?'}</strong><p>${isVerifiedFloodX(best) ? 'Property-record flood zone' : 'Flood zone unverified'}</p></div></div>
      <p class="candidate-structure">${escape(best.convertibleSpace || 'Conversion space needs verification.')}</p>
      <div class="candidate-bottom"><p><strong>Next step</strong><br>${nextAction(best)}</p><a class="button" href="#property-${escape(best.id)}">View evidence <span aria-hidden="true">↗</span></a></div>` : '<h2>No active candidate</h2><p>Verify the remaining properties before making a recommendation.</p>'}
      <p class="candidate-note">Ranked from recorded evidence. Confirm eligibility, flood zone and conversion dimensions before committing.</p></section>
    <aside class="queue"><p class="eyebrow">DECISION QUEUE</p><h2>Resolve these next.</h2>${ranked.slice(0,4).map((row,i) => `<a href="#property-${escape(row.id)}" class="queue-item"><span>${i+1}</span><div><strong>${escape(row.address)}</strong><p>${nextAction(row)}</p></div><span aria-hidden="true">↗</span></a>`).join('') || '<p>No active properties.</p>'}<p class="queue-foot">Permanent constraints first. Price comes after eligibility, size, flood evidence and structure.</p></aside></div>
    ${priceChanges.length ? `<section class="changes"><h2>Price movement</h2>${priceChanges.map(change => `<p>${escape(change.address)}: ${typeof change.before === 'number' ? money(change.before) : 'Unknown'} → ${typeof change.after === 'number' ? money(change.after) : 'Unknown'}</p>`).join('')}</section>` : ''}
    <section id="inventory"><div class="section-title"><div><p class="eyebrow">THE WORKING LIST</p><h2>Full candidate board</h2></div><span>${inventory.length} properties to evaluate</span></div>
    <form class="filters" onsubmit="return false"><div class="search-field"><label for="search">Find an address</label><input id="search" type="search" placeholder="Street number or name"></div><div><label for="status">Show</label><select id="status"><option value="all">Active &amp; needs verification</option value="active">Active only</option><option value="needs_verification">Needs verification</option></select></div>
    <div><label for="sort">Sort by</label><select id="sort"><option value="rank">Decision rank</option><option value="price">Lowest price</option><option value="adu">Largest legal ADU</option></select></div><label class="check"><input id="flood" type="checkbox">Property-record Zone X</label><button type="reset">Reset</button></form>
    <p id="result-count" class="muted" aria-live="polite">${inventory.length} properties shown</p><div id="property-list">${inventory.map(property).join('')}</div><p id="empty" hidden>No properties match these filters.</p></section>
    <section id="comps"><div class="section-title"><div><p class="eyebrow">WATCH THE CLOSING PRICE</p><h2>Under-contract comps</h2></div><span>${comps.length} properties</span></div>${comps.map(property).join('') || '<p class="muted">No under-contract comps recorded.</p>'}</section>
    <section id="archive"><details><summary>Archive <span>${archive.length} ruled-out, sold or off-market properties</span></summary><p class="muted">Kept for research history. Excluded from active recommendations.</p>${archive.map(property).join('')}</details></section>
    <section id="diagnostics" class="diagnostics"><div><p class="eyebrow">SCAN STATUS</p><h2>Know what was checked.</h2><p>${snapshot ? 'The imported board is available. No completed scan report has been saved yet.' : `${run.queriedAddresses} parcel queries · ${run.matchedAddresses} exact matches · ${escape(run.mode)} search`}</p>
    <p>City self-test: <strong>${snapshot ? 'Not yet recorded' : run.parcelSelfTest.passed ? 'Passed' : 'Failed · prior state preserved'}</strong></p>
    <p>Delisting checks: <strong>${run?.delistingEvaluated ? 'Evaluated' : 'Not performed'}</strong></p><p class="muted">${scheduled ? 'Scheduled around 6 AM Eastern. GitHub may start jobs late.' : 'Automatic scheduling is not enabled for this build.'}</p></div>
    <div><h3>${snapshot ? 'Source coverage' : `${sourceFailures} source failures`}</h3>${sources.length ? `<ul>${sources.map(source => `<li><strong>${escape(source.source)}</strong> <span>${source.candidates.length} observations · ${source.failure ? 'Incomplete / unavailable' : 'Read successfully'}</span></li>`).join('')}</ul>` : '<p>Trulia · Coldwell Banker · Homes.com · Zillow</p><p class="muted">Availability is recorded per source on every run.</p>'}
    <p class="muted">Carry estimates use the saved board assumptions, before rent offsets or property-specific renovation costs. They are not a financing quote.</p></div></section>
    </main><footer><strong>St. Pete ADU Board</strong><span>${state.listings.length} properties · $437,000 search ceiling · Evidence over assumptions.</span></footer><script>${interactions}</script></body></html>`;
}
