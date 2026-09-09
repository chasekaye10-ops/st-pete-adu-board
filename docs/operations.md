# Manual daily scan

Run from the project directory:

```sh
npm run scan -- --dry-run --no-ai
```

Preview fetches approved sources and City parcels, prints a report with proposed
changes, and does not write state or a dated run report. `stateChanged` is false
for previews; `changes` contains proposals. It still takes the scan lock.

```sh
npm run scan -- --no-ai
```

This runs the real update and writes `data/runs/YYYY-MM-DD.json`, using the
America/New_York calendar date. Omit `--no-ai` to use optional analysis only when
both OPENAI_API_KEY and OPENAI_MODEL are configured in the environment. Model
analysis can incur API charges. No model status is treated as a targeted delisting
confirmation.

The City schema/self-test runs first. If it fails, the job records narrow source
diagnostics and preserves the entire previous board. If it passes, the job queries
each normalized address once. Wide mode runs only when narrow finds fewer than
three distinct new eligible properties. Failed sources are recorded; they never
imply sold or deleted listings. This version does not perform targeted delisting
checks, and every report explicitly sets delistingEvaluated=false.

## Persistence and reruns

The command holds `data/.scan-lock` for the full run. It refuses a second live
scan for the same Eastern date if its report already exists. Preview is still
available. Reports are published through an exclusive link from a complete
temporary file, so an existing report cannot be overwritten. State uses an
atomic rename after validation. If report publication fails, the runner attempts
to restore the previous state and exits with an error. Ordinary source and state
write failures are recorded as diagnostics and exit zero; inability to load state,
acquire the lock or persist a report exits nonzero.

State and report are separate files, not one transactional database. A process
kill between the state rename and report publication may leave updated state
without a report. A killed run may also leave the lock directory. Before recovery,
confirm no scan process is running, inspect state and Git differences, and restore
the prior state from version control if appropriate. Then remove only the stale
empty lock directory and rerun. Do not automatically delete locks on startup.

The import regression checks the 112 preserved legacy evidence records, allowing
current inventory and prices to change while still detecting loss of the original
board. Source-specific limits and observed availability are in `docs/sources.md`.

## Not yet enabled

This command is manually runnable. No GitHub schedule, deployment, or hosted
dashboard has been enabled. Those are subsequent plan tasks.

## First preview

The 2026-09-08 Eastern live preview passed the City schema and known-parcel
self-test (1521 12th St S, NT-2, approximately 6225 square feet, eligible).
It completed narrow and wide collection with stateChanged=false and no model
requests. Homes.com access failures, unsupported/oversized pages, some missing
Trulia wide-record fields and unknown City verdicts were retained as diagnostics.
These reduce coverage; a completed run does not mean every source succeeded.
