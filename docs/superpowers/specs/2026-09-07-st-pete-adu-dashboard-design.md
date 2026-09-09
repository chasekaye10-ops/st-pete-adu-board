# St. Pete ADU Board — hosted dashboard design

**Status:** Proposed and user-reviewed in chat on 2026-09-07.  
**Goal:** Replace the prior Claude cloud artifact with a hosted, shareable-by-link dashboard that runs a daily 6:00 AM America/New_York St. Petersburg ADU listing scan.

## Decisions

- **Hosting:** GitHub Pages, deployed from GitHub Actions.
- **Visibility:** Public by link. It is not access-controlled; no secrets, contact details, or private offer/financing material may be published.
- **Automation:** GitHub Actions runs the scan entirely in the cloud, calls the OpenAI API only through a GitHub Actions secret, commits changed state, and deploys the static site.
- **Schedule:** Daily at 6:00 AM America/New_York. Because GitHub Actions cron is UTC-only, schedule both 10:00 and 11:00 UTC and use a timezone-aware guard so exactly the run whose local time is 06:00 proceeds across DST.
- **Visual hierarchy:** Decision-first. The daily conclusion, buy candidate, changes, and next actions precede the full research inventory.
- **Starting data:** The 2026-09-07 exported state-of-record document and `boarddata.json` are imported as the initial snapshot. The new repository state becomes canonical after migration.

## Repository layout

```
data/
  state.json              # Canonical listings, evidence, history, diagnostics
  runs/                   # Immutable daily summaries (one JSON file per run)
src/
  scan/                   # Source adapters, parcel matching, scoring, state merge
  render/                 # Static dashboard generator
site/                     # Generated Pages output; never hand-edited
tests/
  fixtures/               # Saved source responses and state fixtures
.github/workflows/
  daily-scan.yml          # Scheduled scan, test, commit, deploy
  deploy.yml              # Optional manual/static deployment workflow
docs/
  sources.md              # Approved URLs and source-specific constraints
  operations.md           # Setup, secrets, failure recovery, manual runbook
```

The repository can remain private when the selected GitHub plan permits Pages from private repositories. If it must be public for Pages, the source and generated state are designed to be publish-safe; GitHub secrets remain private in either configuration.

## Canonical state model

Each property uses a stable normalized address key plus structured fields for:

- listing facts: address, URL(s), source, price, price history, beds/baths, house square footage, year built, status, first/last seen;
- parcel decision: query timestamp, matched parcel address, zoning, lot square footage, `CRITERIA` verdict, verbatim `NTCRIT`, eligibility state (`yes`, `no`, `staff`, `unknown`);
- investment evidence: convertible-space verdict and cited detail, construction material, flood zone and source strength, legal max ADU, achievable conversion footprint and confidence, conversion estimate, all-in estimate, net annual carry;
- lifecycle: active, under contract/comp, needs verification, ruled out, or gone (with confirmed date and evidence);
- audit evidence: source URL, extraction time, quote/fact, confidence, and any model-assisted interpretation.

`state.json` is the only editable durable store. The dashboard and per-run summaries are generated views. Historical price/status/flood records are appended, not overwritten.

## Daily scan flow

1. Validate the City ADU layer schema and execute the known address self-test.
2. Fetch only the approved neighborhood/ZIP listing sources. Respect host-specific constraints, pagination rules, and source failures.
3. Restrict to in-criteria single-family listings under the settled $437,000 cap.
4. Query the City parcel layer per address, using wildcard address matching. Interpret `CRITERIA` as the verdict and retain the literal `NTCRIT` rationale.
5. Extract convertible-space, construction, flood, price, and listing-status evidence. Treat flood evidence as source-ranked; do not infer a FEMA zone from marketing language.
6. Compute max ADU as `min(800, round(houseSf * 0.67))`; preserve achievable conversion footprint separately because a legal ceiling is not a physical garage footprint.
7. Merge results into canonical state. Add evidence and deltas; do not delete index-absent listings. Mark `gone` only after targeted confirmation.
8. Generate the decision-first Pages site plus a compact run summary. Run tests and build validation.
9. On success, commit changed generated/state files and publish. On failure, preserve the previous deployment and create a visible diagnostic; do not replace the board with an empty result.

## Dashboard behavior

### Landing view

1. **Today’s verdict:** run timestamp, number of new in-criteria listings, significant changes, failed sources, and endpoint self-test status.
2. **Buy candidate:** recommendation, price, legal/achievable ADU size, verified eligibility, flood evidence, convertible structure, risks, and next action.
3. **Decision queue:** properties requiring a call, measurement, flood-map check, permit check, or tour.
4. **Ranked candidate board:** filters and sort controls with the durable facts visible.
5. **Evidence drawer/detail view:** price timeline, parcel response, source citations, flood/conversion evidence, and run history.
6. **Diagnostics/archive:** sources and endpoints, current mode, run history, under-contract comps, ruled-out rows, and confirmed-gone records.

### Ranking

The primary candidate ordering is legal maximum ADU, then flood confidence, structure quality/achievable footprint, then price/carry. The decision brief may identify an exception only when the specific evidence is displayed. Under-contract listings remain visible as comps and cannot be recommended as active purchases.

## Reliability and safety

- OpenAI API credentials are GitHub Actions secrets; browser code receives no secret.
- Source failures and API failures are independently recorded and shown on the site.
- Existing data is never cleared by a failed or partial run.
- The workflow writes a dated run file before deployment, so an outcome can be traced to inputs and decisions.
- The manual runbook includes re-run, rollback, secret rotation, source-adapter disablement, and state restore procedures.
- GitHub Action schedules are best-effort; the dashboard shows the last completed run time and exposes manual workflow dispatch for recovery.

## Test strategy

- Unit tests: address normalization, parcel verdict mapping, max-ADU calculation, carry calculation, ranking, and state merges.
- Fixture tests: known-good ADU self-test and saved source cards, including missing, stale, conflicting, and multi-match cases.
- Regression tests: preserve imported 112-row count and key facts for the documented 4219, 3940, 4728, and 2901 records.
- Build tests: generated site has no API key or internal-only data, all listing links render, and summary counters match canonical state.
- Workflow tests: failed source/parsing paths retain prior state and emit diagnostics rather than deploying an empty board.

## Delivery milestones

1. Create repository structure, import/export parser, normalized state, and static dashboard that faithfully represents the provided board.
2. Build the decision-first view, filtering, details/evidence, diagnostics, and regression tests.
3. Implement source adapters, parcel self-test/matching, scoring, and state merge in a manually runnable command.
4. Add GitHub Actions, OpenAI secret configuration, 6 AM ET schedule guard, Pages deployment, and operations documentation.
5. Validate one dry run and one deployment before enabling the scheduled workflow.

## Out of scope for the first release

- Authenticated viewer accounts.
- Automatic offer submission, agent outreach, or purchase execution.
- Direct scraping of sources that are bot-blocked or expressly unusable in the supplied workflow.
- Treating model conclusions as replacements for cited source evidence or city/flood verification.
