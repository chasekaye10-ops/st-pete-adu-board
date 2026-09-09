# Hosted St. Pete ADU Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a decision-first St. Pete ADU dashboard that imports the existing 112-row board and updates itself every day at 6:00 AM America/New_York.

**Architecture:** A TypeScript/Node scan program owns normalized state and immutable daily run records. It fetches approved sources, uses the City parcel layer for eligibility, merges evidence without destructive deletes, then renders a dependency-light static site. GitHub Actions runs the job in the cloud, commits valid state changes, and deploys the static output to GitHub Pages.

**Tech Stack:** Node.js 22, TypeScript, Vitest, Zod, OpenAI JavaScript SDK, native `fetch`, GitHub Actions, GitHub Pages, static HTML/CSS/vanilla JavaScript.

**Spec:** `docs/superpowers/specs/2026-09-07-st-pete-adu-dashboard-design.md`

## Global Constraints

- The settled listing price cap is **$437,000**.
- Run daily at **6:00 AM America/New_York**, including DST; GitHub Actions cron is UTC-only.
- `data/state.json` is the durable source of record; dashboard output is generated and never hand-edited.
- Publish no secrets, personal contact information, API keys, or private offer/financing data.
- Do not erase existing state after a partial or failed scan.
- ADU eligibility comes from `CRITERIA`, with `NTCRIT` retained verbatim as evidence.
- A legal maximum ADU and an achievable convertible footprint are independent fields.
- Never mark a listing gone from pagination/index absence alone.
- The published site is public by link, not authenticated.

---

## File structure

```
package.json                         # Commands and locked dependencies
tsconfig.json                        # Strict TypeScript settings
vitest.config.ts                     # Test discovery and coverage config
input/boarddata.json                 # One-time copied legacy export; ignored after import
src/domain/types.ts                  # State, evidence, listing, parcel and run interfaces
src/domain/calculations.ts           # Max-ADU, carry, scoring and ranking functions
src/domain/state.ts                  # Validation, loading and atomic state writes
src/import/legacy.ts                 # Legacy board-data import normalization
src/sources/http.ts                  # Bounded fetch and source-result diagnostics
src/sources/listings.ts              # Approved source adapters and listing extraction
src/sources/parcel.ts                # ArcGIS self-test, schema check and parcel query
src/analysis/listing-analysis.ts     # OpenAI structured extraction of listing evidence
src/scan/merge.ts                    # Non-destructive state merge and lifecycle updates
src/scan/run.ts                      # Daily scan orchestration and dated run record
src/render/dashboard.ts              # Decision-first static-site renderer
src/cli/import-legacy.ts             # One-time import command
src/cli/scan.ts                      # Daily job command
src/cli/render.ts                    # Render-only command
scripts/is-six-am-et.mjs             # DST-aware GitHub Actions time guard
site/index.html                      # Generated dashboard; ignored by source edits
data/state.json                      # Canonical, committed normalized state
data/runs/YYYY-MM-DD.json            # Immutable daily run record
tests/domain/*.test.ts               # Pure calculation and state tests
tests/sources/*.test.ts              # Parcel/listing adapter fixture tests
tests/scan/*.test.ts                 # Merge and orchestration tests
tests/render/dashboard.test.ts       # Output and publication-safety tests
.github/workflows/daily-scan.yml     # Scheduled daily scan/test/commit/deploy
.github/workflows/deploy.yml         # Manual Pages deployment
docs/sources.md                      # Approved URLs and source constraints
docs/operations.md                   # Secrets, Pages setup, recovery and rollback
```

### Task 1: Bootstrap the TypeScript project and test runner

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/domain/calculations.ts`
- Create: `tests/domain/calculations.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces `calculateMaxAdu(houseSf: number): number` for later ranking and rendering.

- [ ] **Step 1: Write the failing calculation test**

```ts
import { describe, expect, it } from 'vitest';
import { calculateMaxAdu } from '../../src/domain/calculations.js';

describe('calculateMaxAdu', () => {
  it('caps a 1,950-square-foot home at 800 square feet', () => {
    expect(calculateMaxAdu(1950)).toBe(800);
  });
  it('uses 67 percent, rounded, below the city cap', () => {
    expect(calculateMaxAdu(975)).toBe(653);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- calculations.test.ts`

Expected: FAIL because project configuration and `calculateMaxAdu` do not exist.

- [ ] **Step 3: Add project configuration and minimal implementation**

```json
{
  "type": "module",
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "devDependencies": { "@types/node": "^22.0.0", "typescript": "^5.0.0", "vitest": "^3.0.0" }
}
```

```ts
export function calculateMaxAdu(houseSf: number): number {
  return Math.min(800, Math.round(houseSf * 0.67));
}
```

Configure strict TypeScript with NodeNext module resolution. Ignore `node_modules/`, `site/`, `.env`, and `.superpowers/`.

- [ ] **Step 4: Run validation**

Run: `npm install && npm test -- calculations.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/domain/calculations.ts tests/domain/calculations.test.ts .gitignore
git commit -m "chore: bootstrap ADU board project"
```

### Task 2: Define validated canonical state and import the legacy board snapshot

**Files:**
- Create: `src/domain/types.ts`
- Create: `src/domain/state.ts`
- Create: `src/import/legacy.ts`
- Create: `src/cli/import-legacy.ts`
- Create: `tests/import/legacy.test.ts`
- Create: `input/README.md`
- Create: `data/.gitkeep`

**Interfaces:**
- Consumes `calculateMaxAdu(houseSf: number): number`.
- Produces `importLegacy(rows: LegacyRow[], importedAt: string): BoardState` and `writeState(path: string, state: BoardState): Promise<void>`.

- [ ] **Step 1: Write a failing import regression test**

```ts
it('imports 4219 as an active strong match with the documented facts', () => {
  const state = importLegacy([{ a: '4219 5th Ave N', p: 365000, bd: '3/2', sf: 1950, z: 'NTM-1', lot: 5502, t: 'strong', cv: 'Attached 2-car garage' }], '2026-09-07');
  expect(state.listings[0]).toMatchObject({ address: '4219 5th Ave N', price: 365000, maxAdu: 800, lifecycle: 'active', adu: 'yes' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- legacy.test.ts`

Expected: FAIL because importer/types do not exist.

- [ ] **Step 3: Define the state contract and importer**

Use Zod to validate file input and writes. `Listing` must include `id`, `address`, `price`, `bedsBaths`, `houseSf`, `maxAdu`, `adu`, `lifecycle`, `evidence`, `history`, and `updatedAt`. Model `adu` as `'yes' | 'no' | 'staff' | 'unknown'`; model lifecycle as `'active' | 'under_contract' | 'needs_verification' | 'ruled_out' | 'gone'`.

Create `input/README.md` that instructs the operator to copy the provided `boarddata.json` there, then run:

```bash
npx tsx src/cli/import-legacy.ts input/boarddata.json data/state.json 2026-09-07
```

Map legacy flags (`uc`, `hot`, `dq`, `flag`, `note`, `fz`, `fzAe`, `cv`, `achv`, `cc`, `st`) to structured data plus a preserved `legacyNote` evidence record; do not discard unmatched legacy values.

- [ ] **Step 4: Add the full-export regression fixture**

Copy the user-supplied `boarddata.json` to `input/boarddata.json`, run the importer, and assert in a test that the resulting state has 112 listings and includes `2901 Dr ML King Jr St S`, `4728 9th Ave N`, `3940 Burlington Ave N`, and `4219 5th Ave N`.

- [ ] **Step 5: Run validation**

Run: `npm test -- legacy.test.ts && npm run typecheck && npx tsx src/cli/import-legacy.ts input/boarddata.json data/state.json 2026-09-07`

Expected: PASS; `data/state.json` contains 112 rows.

- [ ] **Step 6: Commit**

```bash
git add src/domain src/import src/cli/import-legacy.ts tests/import input/README.md input/boarddata.json data/state.json
git commit -m "feat: import legacy ADU board state"
```

### Task 3: Implement calculations, evidence ranking, and decision-first candidate sorting

**Files:**
- Modify: `src/domain/calculations.ts`
- Create: `tests/domain/ranking.test.ts`

**Interfaces:**
- Consumes `Listing` from `src/domain/types.ts`.
- Produces `calculateAnnualCarry(price: number): number`, `rankListings(listings: Listing[]): Listing[]`, and `isVerifiedFloodX(listing: Listing): boolean`.

- [ ] **Step 1: Write failing ranking tests**

```ts
it('puts an active 800-sf Zone X block candidate ahead of a 653-sf frame candidate', () => {
  expect(rankListings([frame653, block800X]).map((row) => row.id)).toEqual([block800X.id, frame653.id]);
});
it('does not rank under-contract comps as buy candidates', () => {
  expect(rankListings([active, underContract])[0].lifecycle).toBe('active');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ranking.test.ts`

Expected: FAIL because ranking exports do not exist.

- [ ] **Step 3: Implement deterministic calculations**

Implement carry as `33424 + 0.09619 * (price - 279900)`, rounded to the nearest dollar. Sort active candidates by: ADU eligibility (`yes`, then `staff`, then `unknown`, then `no`), `maxAdu` descending, verified Zone X flood evidence, confirmed convertible structure, achievable footprint descending, construction (`block` before `frame`), then price ascending. Keep `under_contract`, `ruled_out`, and `gone` out of the active recommendation list.

- [ ] **Step 4: Run validation**

Run: `npm test -- ranking.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/calculations.ts tests/domain/ranking.test.ts
git commit -m "feat: rank ADU candidates by permanent constraints"
```

### Task 4: Build the City parcel client with self-test and verdict mapping

**Files:**
- Create: `src/sources/http.ts`
- Create: `src/sources/parcel.ts`
- Create: `tests/sources/parcel.test.ts`
- Create: `tests/fixtures/parcel-self-test.json`

**Interfaces:**
- Produces `selfTestParcelApi(fetcher: Fetcher): Promise<ParcelSelfTest>`, `lookupParcel(address: string, fetcher: Fetcher): Promise<ParcelLookup>`, and `mapCriteria(value: string | null): AduStatus`.

- [ ] **Step 1: Write failing verdict tests**

```ts
expect(mapCriteria('Meets criteria for ADU')).toBe('yes');
expect(mapCriteria('Does not meet criteria')).toBe('no');
expect(mapCriteria('Contact city staff')).toBe('staff');
expect(mapCriteria(null)).toBe('unknown');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- parcel.test.ts`

Expected: FAIL because parcel module does not exist.

- [ ] **Step 3: Implement bounded endpoint access**

Implement an injected `Fetcher` with a 15-second timeout, response-size limit, and diagnostic result. Validate the schema fields `ADDRESS`, `ZONING`, `NTCRIT`, `SQFT`, `CRITERIA`. Use the specified known-good self-test address pattern. Build per-address query patterns with a wildcard between number and street token, URL-encode values, and reject generated URLs over 250 characters before making a request. Preserve `NTCRIT` exactly; render `SQFT: 0` as zoning-qualified rather than zero-area.

- [ ] **Step 4: Add fixture tests for two-space address and ambiguous match handling**

Use a fixture matching `1521  12TH ST S` and assert an input `1521 12th St S` succeeds. Add a multiple-match fixture and assert it returns `unknown` with `ambiguous: true` if directional suffix cannot resolve it.

- [ ] **Step 5: Run validation**

Run: `npm test -- parcel.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/sources/http.ts src/sources/parcel.ts tests/sources/parcel.test.ts tests/fixtures/parcel-self-test.json
git commit -m "feat: add verified City ADU parcel lookups"
```

### Task 5: Add listing-source adapters and structured evidence analysis

**Files:**
- Create: `src/sources/listings.ts`
- Create: `src/analysis/listing-analysis.ts`
- Create: `tests/sources/listings.test.ts`
- Create: `tests/analysis/listing-analysis.test.ts`
- Create: `tests/fixtures/listing-card.html`
- Create: `docs/sources.md`

**Interfaces:**
- Consumes `Fetcher` and `ListingCandidate`.
- Produces `fetchCandidates(mode: 'narrow' | 'wide', fetcher: Fetcher): Promise<SourceSweep>` and `analyzeListing(input: ListingAnalysisInput, client: OpenAiClient): Promise<ListingEvidence>`.

- [ ] **Step 1: Write a failing adapter test**

```ts
it('extracts a single-family candidate and its convertible feature from an index-card fixture', async () => {
  const sweep = await fetchCandidates('narrow', fixtureFetcher);
  expect(sweep.candidates[0]).toMatchObject({ propertyType: 'single_family', address: '4219 5th Ave N', price: 365000 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- listings.test.ts`

Expected: FAIL because adapters do not exist.

- [ ] **Step 3: Implement approved source inventory**

Hard-code the approved narrow and wide URL sets from the reviewed state/skill documentation. Exclude Redfin, BEX, and Trulia Wildwood Heights. Each adapter must return `SourceResult` with `source`, `url`, `fetchedAt`, `candidates`, and an explicit `failure` value instead of throwing away the run. Do not routinely fetch detail pages; cap detail fetches at two per run.

- [ ] **Step 4: Add model-assisted extraction behind a strict schema**

Use the OpenAI SDK with `OPENAI_API_KEY` and configurable `OPENAI_MODEL`. The response schema must contain only: `convertibleStatus`, `convertibleDetail`, `construction`, `flood`, `listingStatus`, `confidence`, and `evidenceQuote`. Reject results lacking an evidence quote; keep the original source URL and text snippet with every fact. When no API key is available, return `unknown` evidence and continue the scan.

- [ ] **Step 5: Run validation**

Run: `npm test -- listings.test.ts listing-analysis.test.ts && npm run typecheck`

Expected: PASS with zero network calls in tests.

- [ ] **Step 6: Commit**

```bash
git add src/sources/listings.ts src/analysis/listing-analysis.ts tests/sources tests/analysis tests/fixtures docs/sources.md package.json package-lock.json
git commit -m "feat: collect listing candidates with cited evidence"
```

### Task 6: Merge daily scan output without destructive lifecycle changes

**Files:**
- Create: `src/scan/merge.ts`
- Create: `tests/scan/merge.test.ts`

**Interfaces:**
- Consumes `BoardState`, `ListingCandidate[]`, `ParcelLookup[]`, and `ListingEvidence[]`.
- Produces `mergeScan(previous: BoardState, observations: Observation[], runAt: string): MergeResult`.

- [ ] **Step 1: Write failing lifecycle tests**

```ts
it('keeps a prior listing active when it is absent from a paginated sweep', () => {
  expect(mergeScan(previousWith4219, [], '2026-09-08').state.listings[0].lifecycle).toBe('active');
});
it('appends a price record instead of replacing history', () => {
  expect(mergeScan(previousAt365, [observationAt355], '2026-09-08').state.listings[0].history.price).toHaveLength(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- merge.test.ts`

Expected: FAIL because merge module does not exist.

- [ ] **Step 3: Implement stable merge behavior**

Use normalized address keys as identity. Add new named-neighborhood unknown-parcel records, but only add wide-sweep records when parcel status is `yes`. Merge evidence append-only by `(sourceUrl, fact, observedAt)` identity. Preserve imported state fields not refreshed this run. Only accept `gone` when an observation explicitly has `statusConfirmation: 'gone'` plus a source URL.

- [ ] **Step 4: Add no-change and failed-source diagnostic tests**

Assert a source failure keeps all existing rows and adds a diagnostic. Assert a no-change run reports zero deltas and does not change any price history.

- [ ] **Step 5: Run validation**

Run: `npm test -- merge.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/scan/merge.ts tests/scan/merge.test.ts
git commit -m "feat: preserve state across daily scan merges"
```

### Task 7: Orchestrate a daily job and write immutable run records

**Files:**
- Create: `src/scan/run.ts`
- Create: `src/cli/scan.ts`
- Create: `tests/scan/run.test.ts`
- Create: `data/runs/.gitkeep`

**Interfaces:**
- Consumes `fetchCandidates`, `selfTestParcelApi`, `lookupParcel`, `analyzeListing`, `mergeScan`, and `writeState`.
- Produces `runDailyScan(deps: ScanDependencies, now: Date): Promise<DailyRun>`.

- [ ] **Step 1: Write a failing orchestration test**

```ts
it('writes a diagnostic-only run and preserves state when the parcel self-test fails', async () => {
  const run = await runDailyScan(failedParcelDependencies, new Date('2026-09-08T10:00:00Z'));
  expect(run.parcelSelfTest.passed).toBe(false);
  expect(run.stateChanged).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- run.test.ts`

Expected: FAIL because daily orchestration does not exist.

- [ ] **Step 3: Implement narrow/wide decision and persistence**

Execute parcel self-test first. Run narrow sources; switch to wide sources only if self-test passes and narrow finds fewer than three new in-criteria candidates. Produce `data/runs/YYYY-MM-DD.json` with mode, gate reason, source results, queried/matched address counts, changes, and failures. Atomically write state only after validation. The CLI exits non-zero only for an internal failure that prevents a valid diagnostic record; ordinary source failure exits zero after recording diagnostics.

- [ ] **Step 4: Run validation**

Run: `npm test -- run.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scan/run.ts src/cli/scan.ts tests/scan/run.test.ts data/runs/.gitkeep
git commit -m "feat: run daily ADU scan with durable diagnostics"
```

### Task 8: Render and test the decision-first public dashboard

**Files:**
- Create: `src/render/dashboard.ts`
- Create: `src/cli/render.ts`
- Create: `tests/render/dashboard.test.ts`
- Create: `site/.nojekyll`

**Interfaces:**
- Consumes `BoardState` and latest `DailyRun`.
- Produces `renderDashboard(state: BoardState, run: DailyRun): string`.

- [ ] **Step 1: Write a failing output test**

```ts
it('renders the buy candidate before the full inventory and never embeds secrets', () => {
  const html = renderDashboard(stateWith4219, successfulRun);
  expect(html.indexOf('BUY CANDIDATE')).toBeLessThan(html.indexOf('Full candidate board'));
  expect(html).not.toContain('OPENAI_API_KEY');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- dashboard.test.ts`

Expected: FAIL because renderer does not exist.

- [ ] **Step 3: Implement static, accessible dashboard**

Generate one self-contained `site/index.html` with semantic headings, responsive CSS, no runtime framework, and escaped listing/evidence content. Render: run verdict, source/endpoint diagnostics, buy candidate, decision queue, filters, active ranked board, evidence details, under-contract comps, and ruled-out/gone archive. Add client-side filter controls that operate only on already-rendered public state. Show flood source strength and explicit `unknown` values instead of empty success-looking cells.

- [ ] **Step 4: Add regression/render tests**

Render the imported state and assert 4219 appears in the decision card, 4728 appears only in comps, 2901 shows its AE demotion, and the HTML does not contain an API key-like string or a raw `legacyNote` with private content.

- [ ] **Step 5: Run validation**

Run: `npm test -- dashboard.test.ts && npx tsx src/cli/render.ts data/state.json data/runs/2026-09-07.json site/index.html`

Expected: PASS; `site/index.html` exists and opens without a server.

- [ ] **Step 6: Commit**

```bash
git add src/render src/cli/render.ts tests/render site/.nojekyll .gitignore
git commit -m "feat: render decision-first public ADU board"
```

### Task 9: Configure GitHub Actions, DST guard, commits, and Pages deployment

**Files:**
- Create: `scripts/is-six-am-et.mjs`
- Create: `.github/workflows/daily-scan.yml`
- Create: `.github/workflows/deploy.yml`
- Create: `docs/operations.md`

**Interfaces:**
- Consumes `npm test`, `npm run typecheck`, `npx tsx src/cli/scan.ts`, and `npx tsx src/cli/render.ts`.
- Produces a GitHub Pages deployment and a committed `data/state.json` / `data/runs` change set.

- [ ] **Step 1: Write a failing timezone-guard test**

```ts
import { isSixAmEastern } from '../scripts/is-six-am-et.mjs';
expect(isSixAmEastern(new Date('2026-07-01T10:00:00Z'))).toBe(true);
expect(isSixAmEastern(new Date('2026-01-01T10:00:00Z'))).toBe(false);
expect(isSixAmEastern(new Date('2026-01-01T11:00:00Z'))).toBe(true);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/scripts/is-six-am-et.test.mjs`

Expected: FAIL because guard module does not exist.

- [ ] **Step 3: Implement workflow and deployment**

Implement `isSixAmEastern` with `Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' })`. Schedule `0 10,11 * * *`; skip the scan unless the guard succeeds. Add `workflow_dispatch` for recovery. The daily workflow must install Node 22, run tests/typecheck, run scan with `OPENAI_API_KEY` and `OPENAI_MODEL`, render, commit only state/run/site changes with `github-actions[bot]`, and deploy the `site/` artifact using official Pages actions. `deploy.yml` performs build/test/deploy through `workflow_dispatch` without scanning.

- [ ] **Step 4: Document manual GitHub setup and recovery**

In `docs/operations.md`, specify: create repository; enable Pages via GitHub Actions; set `OPENAI_API_KEY` and `OPENAI_MODEL` repository secrets; grant Actions contents-write and Pages permissions; execute a manual workflow dispatch; verify published URL; rotate keys; disable a failing adapter; restore state from Git history; and rerun a failed date. State plainly that GitHub schedules can be delayed and dashboard diagnostics show last successful run.

- [ ] **Step 5: Run validation**

Run: `node --test tests/scripts/is-six-am-et.test.mjs && npm test && npm run typecheck`

Expected: PASS. Review workflow YAML to confirm no secret value is echoed.

- [ ] **Step 6: Commit**

```bash
git add scripts/is-six-am-et.mjs tests/scripts/is-six-am-et.test.mjs .github/workflows docs/operations.md
git commit -m "ci: schedule and deploy daily ADU board"
```

### Task 10: Perform first-run acceptance and enable the schedule

**Files:**
- Modify: `docs/operations.md`
- Modify: `data/state.json`
- Create: `data/runs/2026-09-07-migration.json`

**Interfaces:**
- Consumes completed daily workflow, generated Pages URL, and canonical state.
- Produces a verified deployment baseline and enabled schedule.

- [ ] **Step 1: Run the import and render locally**

Run: `npm test && npm run typecheck && npx tsx src/cli/import-legacy.ts input/boarddata.json data/state.json 2026-09-07 && npx tsx src/cli/render.ts data/state.json data/runs/2026-09-07-migration.json site/index.html`

Expected: 112 imported listings and a generated decision-first page containing 4219, 3940, 4728, and 2901.

- [ ] **Step 2: Trigger a manual GitHub Actions deployment**

In GitHub Actions, run `deploy.yml` through **Run workflow**. Do not enable the scheduled workflow until the public-by-link Pages URL renders correctly and contains no secrets or private content.

- [ ] **Step 3: Trigger one manual daily scan**

Run `daily-scan.yml` through **Run workflow**. Confirm a dated run record includes mode, source results, endpoint self-test, candidate count, matched parcel count, and any failures; confirm state was preserved if a source failed.

- [ ] **Step 4: Record acceptance evidence**

Append the Pages URL, deployment commit SHA, import count, first manual run timestamp, and any disabled sources to `docs/operations.md`.

- [ ] **Step 5: Enable normal scheduling and commit**

```bash
git add data/state.json data/runs/2026-09-07-migration.json docs/operations.md
git commit -m "docs: record hosted board acceptance baseline"
```

Expected: The next 6:00 AM America/New_York run can update and publish the board without a local machine.

## Plan self-review

- **Spec coverage:** Tasks 1–3 cover the canonical model, calculations, ranking, and legacy import. Tasks 4–7 cover self-test, approved sources, evidence, non-destructive state, narrow/wide mode, and daily records. Task 8 covers the decision-first public UI and diagnostics. Tasks 9–10 cover cloud scheduling, DST, secrets, deployment, recovery, and acceptance.
- **Placeholder scan:** No deferred implementation markers or undefined follow-up work remain; each task names exact files, interfaces, test commands, and commit scope.
- **Type consistency:** `Listing`, `BoardState`, `DailyRun`, `Fetcher`, `ParcelLookup`, `ListingCandidate`, `ListingEvidence`, and `Observation` are introduced before dependent tasks. The calculated `maxAdu` value is used consistently throughout.
