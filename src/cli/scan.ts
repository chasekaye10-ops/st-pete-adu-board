import { access, mkdir, readFile, rmdir, writeFile, link, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { validateState, writeState } from '../domain/state.js';
import { createFetcher, createTextFetcher } from '../sources/http.js';
import { fetchCandidates } from '../sources/listings.js';
import { lookupParcel, selfTestParcelApi } from '../sources/parcel.js';
import { analyzeListing, createOpenAiClient } from '../analysis/listing-analysis.js';
import { easternDate, runDailyScan } from '../scan/run.js';

const args = process.argv.slice(2);
if (args.some(arg => !['--dry-run', '--no-ai'].includes(arg))) throw new Error('Usage: npm run scan -- [--dry-run] [--no-ai]');
const dryRun = args.includes('--dry-run');
const now = new Date();
const runPath = `data/runs/${easternDate(now)}.json`;
await mkdir('data/runs', { recursive: true });
await mkdir('data/.scan-lock');
try {
  let exists = false;
  try { await access(runPath); exists = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (exists && !dryRun) console.log(`Today's run already exists: ${runPath}. No changes made.`);
  else {
    const json = createFetcher(), html = createTextFetcher();
    const client = args.includes('--no-ai') ? null : createOpenAiClient();
    const run = await runDailyScan({ dryRun,
      loadState: async () => validateState(JSON.parse(await readFile('data/state.json', 'utf8'))),
      selfTest: () => selfTestParcelApi(json), fetchCandidates: mode => fetchCandidates(mode, html),
      lookupParcel: address => lookupParcel(address, json), analyze: input => analyzeListing(input, client),
      writeState: state => writeState('data/state.json', state),
      writeRun: async report => {
        if (dryRun) return;
        const temporary = `${runPath}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
          await link(temporary, runPath);
        } finally { await unlink(temporary).catch(() => {}); }
      },
    }, now);
    console.log(JSON.stringify(run, null, 2));
  }
} finally { await rmdir('data/.scan-lock'); }
