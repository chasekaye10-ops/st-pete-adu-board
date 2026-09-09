import { createHash } from 'node:crypto';
import type { BoardState, Evidence, Listing } from '../domain/types.js';
import { validateState } from '../domain/state.js';
import { calculateMaxAdu } from '../domain/calculations.js';
import type { ListingCandidate } from '../sources/listings.js';
import { mapCriteria, type ParcelLookup } from '../sources/parcel.js';
import type { ListingEvidence } from '../analysis/listing-analysis.js';

export interface Observation {
  candidate: ListingCandidate;
  mode: 'narrow' | 'wide';
  parcel?: ParcelLookup;
  analysis?: ListingEvidence;
  statusConfirmation?: 'gone' | 'under_contract' | 'active';
  statusSourceUrl?: string;
}
export interface MergeChange { id: string; address: string; field: string; before: unknown; after: unknown }
export interface MergeResult { state: BoardState; changes: MergeChange[]; diagnostics: string[] }

export function addressKey(address: string): string {
  const types: Record<string, string> = { STREET: 'ST', AVENUE: 'AVE', ROAD: 'RD', DRIVE: 'DR', COURT: 'CT', PLACE: 'PL', TERRACE: 'TER', BOULEVARD: 'BLVD' };
  return address.toUpperCase().split(',')[0].replace(/\./g, '')
    .replace(/\b(STREET|AVENUE|ROAD|DRIVE|COURT|PLACE|TERRACE|BOULEVARD)\b/g, value => types[value])
    .replace(/\s+/g, ' ').trim();
}
function sourceUrl(value: string | undefined): boolean {
  try { return ['http:', 'https:'].includes(new URL(value ?? '').protocol); } catch { return false; }
}
function time(value: string): number { return Date.parse(value); }
function verifiedParcel(observation: Observation): ParcelLookup | undefined {
  const parcel = observation.parcel;
  return parcel && !parcel.error && !parcel.ambiguous && sourceUrl(parcel.url)
    && parcel.matchedAddress && addressKey(parcel.matchedAddress) === addressKey(observation.candidate.address)
    && parcel.adu !== 'unknown' && mapCriteria(parcel.criteria ?? null) === parcel.adu
    ? parcel : undefined;
}

export function mergeScan(previous: BoardState, observations: Observation[], runAt: string,
  options: { sourceFailures?: string[] } = {}): MergeResult {
  if (!Number.isFinite(time(runAt))) throw new Error('Invalid run timestamp');
  validateState(previous);
  const state = structuredClone(previous);
  const changes: MergeChange[] = [];
  const diagnostics = [...(options.sourceFailures ?? [])];
  const index = new Map<string, Listing>();
  for (const listing of state.listings) {
    const key = addressKey(listing.address);
    if (index.has(key)) throw new Error(`Duplicate saved address: ${listing.address}`);
    index.set(key, listing);
  }
  const groups = new Map<string, Observation[]>();
  for (const observation of observations) {
    const candidate = observation.candidate;
    const key = addressKey(candidate.address);
    if (!key || candidate.propertyType !== 'single_family' || !sourceUrl(candidate.sourceUrl)
      || !Number.isFinite(candidate.price) || candidate.price <= 0 || !Number.isFinite(candidate.houseSf) || candidate.houseSf <= 0
      || !Number.isFinite(time(candidate.fetchedAt)) || time(candidate.fetchedAt) > time(runAt)) {
      diagnostics.push(`Invalid observation: ${candidate.address}`); continue;
    }
    const saved = index.get(key);
    if (saved && time(candidate.fetchedAt) < time(saved.updatedAt)) {
      diagnostics.push(`Stale observation ignored: ${candidate.address}`); continue;
    }
    groups.set(key, [...(groups.get(key) ?? []), observation]);
  }
  for (const [key, group] of groups) {
    let listing = index.get(key);
    const before = listing ? structuredClone(listing) : undefined;
    const currentParcel = (item: Observation): ParcelLookup | undefined => {
      const parcel = verifiedParcel(item);
      return parcel && Number.isFinite(time(parcel.checkedAt)) && time(parcel.checkedAt) <= time(runAt)
        && time(parcel.checkedAt) >= time(before?.updatedAt ?? previous.importedAt) ? parcel : undefined;
    };
    const prices = [...new Set(group.map(item => item.candidate.price))];
    if (!listing) {
      const verdicts = group.map(currentParcel).filter((value): value is ParcelLookup => !!value).map(parcel => parcel.adu);
      if (!group.some(item => item.mode === 'narrow') && !(verdicts.length && verdicts.every(value => value === 'yes'))) {
        diagnostics.push(`Wide addition needs confirmed eligibility: ${key}`); continue;
      }
      if (prices.length !== 1 || prices[0] > 437000) {
        diagnostics.push(`New property price conflict or over cap: ${key}`); continue;
      }
      const candidate = group[0].candidate;
      listing = { id: `listing-${createHash('sha1').update(key).digest('hex').slice(0, 12)}`,
        address: candidate.address, price: candidate.price, houseSf: candidate.houseSf,
        maxAdu: calculateMaxAdu(candidate.houseSf), bedsBaths: candidate.bedsBaths,
        adu: 'unknown', lifecycle: 'needs_verification', evidence: [], history: [], updatedAt: runAt };
      state.listings.push(listing); index.set(key, listing);
    }
    const row = listing;
    const consensus = <T,>(values: T[], field: string): T | undefined => {
      const unique = [...new Set(values)];
      if (unique.length > 1) diagnostics.push(`Conflicting ${field}: ${row.address}`);
      return unique.length === 1 ? unique[0] : undefined;
    };
    const appendEvidence = (evidence: Evidence) => {
      const identity = (item: Evidence) => JSON.stringify([item.sourceUrl ?? item.source, item.kind, item.detail, item.capturedAt]);
      if (!row.evidence.some(item => identity(item) === identity(evidence))) row.evidence.push(evidence);
    };
    const price = consensus(prices, 'price');
    if (price !== undefined) row.price = price;
    const area = consensus(group.map(item => item.candidate.houseSf), 'house area');
    if (area !== undefined) { row.houseSf = area; row.maxAdu = calculateMaxAdu(area); }
    const beds = consensus(group.map(item => item.candidate.bedsBaths).filter(value => value && !value.includes('?')), 'beds/baths');
    if (beds !== undefined) row.bedsBaths = beds;
    const parcels = group.map(currentParcel).filter((value): value is ParcelLookup => !!value);
    const adu = consensus(parcels.map(parcel => parcel.adu), 'ADU verdict');
    if (adu !== undefined) row.adu = adu;
    const zoning = consensus(parcels.map(parcel => parcel.zoning).filter((value): value is string => !!value), 'zoning');
    if (zoning !== undefined) row.zoning = zoning;
    const lot = consensus(parcels.map(parcel => parcel.lotSf).filter((value): value is number => typeof value === 'number' && value > 0), 'lot area');
    if (lot !== undefined) row.lotSf = lot;
    const statuses = group.filter(item => item.statusConfirmation && sourceUrl(item.statusSourceUrl)).map(item => item.statusConfirmation!);
    const status = consensus(statuses, 'listing status');
    if (status && !(status === 'active' && row.lifecycle === 'ruled_out')) {
      row.lifecycle = status === 'active' ? (row.adu === 'no' ? 'ruled_out' : row.adu === 'yes' ? 'active' : 'needs_verification') : status;
    } else if (row.adu === 'no' && row.lifecycle !== 'gone' && row.lifecycle !== 'under_contract') row.lifecycle = 'ruled_out';
    else if (row.lifecycle === 'needs_verification' && row.adu === 'yes') row.lifecycle = 'active';
    if (row.price > 437000 && row.lifecycle === 'active') row.lifecycle = 'needs_verification';
    for (const item of group) {
      const candidate = item.candidate;
      appendEvidence({ kind: 'listing', source: candidate.source, sourceUrl: candidate.sourceUrl,
        sourceText: candidate.snippet, capturedAt: candidate.fetchedAt,
        detail: JSON.stringify({ address: candidate.address, price: candidate.price, houseSf: candidate.houseSf, bedsBaths: candidate.bedsBaths, snippet: candidate.snippet }) });
      if (item.parcel) {
        if (currentParcel(item)) appendEvidence({ kind: 'parcel', source: 'City parcel lookup', sourceUrl: item.parcel.url,
          capturedAt: item.parcel.checkedAt, detail: JSON.stringify(item.parcel) });
        else diagnostics.push(`Parcel unavailable for ${row.address}: ${item.parcel.error ?? 'Unverified or mismatched result'}`);
      }
      if (item.statusConfirmation && sourceUrl(item.statusSourceUrl)) appendEvidence({ kind: 'status', source: 'Targeted confirmation',
        sourceUrl: item.statusSourceUrl, capturedAt: candidate.fetchedAt, detail: item.statusConfirmation });
      if (item.analysis) {
        const analysis = item.analysis;
        if (analysis.failure) diagnostics.push(`Analysis unavailable for ${row.address}: ${analysis.failure}`);
        else if (analysis.sourceUrl === candidate.sourceUrl && analysis.snippet === candidate.snippet
          && analysis.evidenceQuote.trim() && candidate.snippet.includes(analysis.evidenceQuote)) {
          appendEvidence({ kind: 'listingAnalysis', source: candidate.source, sourceUrl: analysis.sourceUrl,
            sourceText: analysis.snippet, capturedAt: analysis.capturedAt, detail: JSON.stringify(analysis), confidence: analysis.confidence });
        } else diagnostics.push(`Unmatched analysis evidence: ${row.address}`);
      }
    }
    const fields = ['price', 'houseSf', 'maxAdu', 'bedsBaths', 'adu', 'lifecycle', 'zoning', 'lotSf'] as const;
    const deltas = before ? fields.filter(field => before[field] !== row[field]).map(field => ({ id: row.id, address: row.address, field, before: before[field], after: row[field] }))
      : [{ id: row.id, address: row.address, field: 'added', before: null, after: row.id }];
    changes.push(...deltas);
    if (deltas.length) row.history.push({ at: runAt, ...(deltas.some(delta => delta.field === 'price' || delta.field === 'added') ? { price: row.price } : {}),
      ...(deltas.some(delta => delta.field === 'lifecycle' || delta.field === 'added') ? { lifecycle: row.lifecycle } : {}), note: JSON.stringify(deltas) });
    if (deltas.length || row.evidence.length !== before?.evidence.length) row.updatedAt = runAt;
  }
  validateState(state);
  return { state, changes, diagnostics: [...new Set(diagnostics)] };
}
