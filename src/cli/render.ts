import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { validateState } from '../domain/state.js';
import type { DailyRun } from '../scan/run.js';
import { renderDashboard } from '../render/dashboard.js';

const [statePath = 'data/state.json', requestedRun, output = 'site/index.html'] = process.argv.slice(2);
const state = validateState(JSON.parse(await readFile(statePath, 'utf8')));
let runPath = requestedRun;
if (!runPath) {
  const reports = (await readdir('data/runs')).filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
  if (reports.length) runPath = `data/runs/${reports.at(-1)}`;
}
let run: DailyRun | null = null;
if (runPath && runPath !== '-') {
  const value = JSON.parse(await readFile(runPath, 'utf8'));
  if (typeof value.completedAt !== 'string' || !Array.isArray(value.sources) || !Array.isArray(value.failures)
    || !Array.isArray(value.changes) || typeof value.parcelSelfTest?.passed !== 'boolean') throw new Error('Invalid daily run report');
  run = value;
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, renderDashboard(state, run, process.env.ADU_SCHEDULE_ENABLED === 'true'), 'utf8');
await writeFile(`${dirname(output)}/.nojekyll`, '', 'utf8');
console.log(`Built ${output} from ${state.listings.length} properties${run ? ` and the ${run.date} report` : ' (imported snapshot)'}.`);
