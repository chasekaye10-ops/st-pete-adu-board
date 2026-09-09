# Legacy board import

Copy the provided `boarddata.json` export into this directory, then run:

```bash
npx tsx src/cli/import-legacy.ts input/boarddata.json data/state.json 2026-09-07
```

The importer preserves the original row fields in each listing's `legacyNote` evidence record.
