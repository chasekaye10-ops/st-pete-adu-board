import type { BoardState } from '../domain/types.js';
import { validateState } from '../domain/state.js';
import type { ListingCandidate, SourceSweep } from '../sources/listings.js';
import type { ParcelLookup, ParcelSelfTest } from '../sources/parcel.js';
import type { ListingAnalysisInput, ListingEvidence } from '../analysis/listing-analysis.js';
import { addressKey, mergeScan, type MergeChange, type Observation } from './merge.js';

export interface ScanDependencies {
  loadState(): Promise<BoardState>;
  selfTest(): Promise<ParcelSelfTest>;
  fetchCandidates(mode: 'narrow' | 'wide'): Promise<SourceSweep>;
  lookupParcel(address: string): Promise<ParcelLookup>;
  analyze(input: ListingAnalysisInput): Promise<ListingEvidence>;
  writeState(state: BoardState): Promise<void>;
  writeRun(run: DailyRun): Promise<void>;
  now?: () => Date;
  dryRun?: boolean;
}
export interface DailyRun {
  date: string;
  startedAt: string;
  completedAt: string;
  mode: 'narrow' | 'wide';
  gateReason: string;
  dryRun: boolean;
  parcelSelfTest: ParcelSelfTest & { passed: boolean };
  sources: SourceSweep[];
  queriedAddresses: number;
  matchedAddresses: number;
  newEligibleNarrow: number;
  changes: MergeChange[];
  failures: string[];
  stateChanged: boolean;
  delistingEvaluated: false;
}
export function easternDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export async function runDailyScan(deps: ScanDependencies, now: Date): Promise<DailyRun> {
  const previous = await deps.loadState();
  validateState(previous);
  const failures: string[] = [];
  let selfTest: ParcelSelfTest;
  try { selfTest = await deps.selfTest(); } catch (error) { selfTest = { ok: false, error: message(error) }; }
  if (!selfTest.ok) failures.push(`Parcel self-test: ${selfTest.error ?? 'Failed'}`);
  const run: DailyRun = { date: easternDate(now), startedAt: now.toISOString(), completedAt: now.toISOString(),
    mode: 'narrow', gateReason: 'Parcel self-test failed; diagnostic-only narrow sweep', dryRun: deps.dryRun ?? false,
    parcelSelfTest: { ...selfTest, passed: selfTest.ok }, sources: [], queriedAddresses: 0, matchedAddresses: 0,
    newEligibleNarrow: 0, changes: [], failures, stateChanged: false, delistingEvaluated: false };
  const sweep = async (mode: 'narrow' | 'wide') => {
    try {
      const result = await deps.fetchCandidates(mode);
      run.sources.push(result);
      for (const source of result.sources) if (source.failure) failures.push(`${source.source}: ${source.failure}`);
      if (result.truncated) failures.push(`${mode}: candidate cap reached`);
      return result.candidates;
    } catch (error) { failures.push(`${mode} sources: ${message(error)}`); return []; }
  };
  const narrow = await sweep('narrow');
  const observations: Observation[] = [];
  const parcels = new Map<string, ParcelLookup>();
  const collect = async (candidates: ListingCandidate[], mode: 'narrow' | 'wide') => {
    for (const candidate of candidates) {
      const key = addressKey(candidate.address);
      let parcel = parcels.get(key);
      if (!parcel) {
        run.queriedAddresses++;
        try { parcel = await deps.lookupParcel(candidate.address); }
        catch (error) { parcel = { adu: 'unknown', ambiguous: false, checkedAt: (deps.now?.() ?? new Date()).toISOString(), error: message(error) }; }
        parcels.set(key, parcel);
        if (!parcel.error && !parcel.ambiguous && parcel.matchedAddress && addressKey(parcel.matchedAddress) === key) run.matchedAddresses++;
        if (parcel.error) failures.push(`${candidate.address}: ${parcel.error}`);
      }
      const observation: Observation = { candidate, mode, parcel };
      try {
        observation.analysis = await deps.analyze({ sourceUrl: candidate.sourceUrl, snippet: candidate.snippet, capturedAt: candidate.fetchedAt });
        if (observation.analysis.failure) failures.push(observation.analysis.failure);
      } catch (error) { failures.push(`Analysis: ${message(error)}`); }
      // Index observations never imply a targeted sold/off-market confirmation.
      observations.push(observation);
    }
  };
  if (selfTest.ok) {
    await collect(narrow, 'narrow');
    const existing = new Set(previous.listings.map(listing => addressKey(listing.address)));
    run.newEligibleNarrow = new Set(observations.filter(item => !existing.has(addressKey(item.candidate.address))
      && item.candidate.price > 0 && item.candidate.price <= 437000 && item.candidate.propertyType === 'single_family'
      && !item.parcel?.error && !item.parcel?.ambiguous && item.parcel?.adu === 'yes'
      && item.parcel.matchedAddress && addressKey(item.parcel.matchedAddress) === addressKey(item.candidate.address))
      .map(item => addressKey(item.candidate.address))).size;
    if (run.newEligibleNarrow < 3) {
      run.mode = 'wide'; run.gateReason = 'Parcel self-test passed; fewer than three new eligible narrow candidates';
      await collect(await sweep('wide'), 'wide');
    } else run.gateReason = 'Narrow sweep found at least three new eligible candidates';
  }
  run.completedAt = new Date(Math.max(now.getTime(), (deps.now?.() ?? new Date()).getTime())).toISOString();
  if (selfTest.ok) {
    const merged = mergeScan(previous, observations, run.completedAt, { sourceFailures: failures });
    run.changes = merged.changes;
    failures.push(...merged.diagnostics);
    if (!run.dryRun && JSON.stringify(merged.state) !== JSON.stringify(previous)) {
      try { await deps.writeState(merged.state); run.stateChanged = true; }
      catch (error) { failures.push(`State persistence: ${message(error)}`); run.changes = []; }
    }
  }
  run.failures = [...new Set(failures)];
  try { await deps.writeRun(run); }
  catch (error) {
    if (run.stateChanged) await deps.writeState(previous);
    throw error;
  }
  return run;
}
