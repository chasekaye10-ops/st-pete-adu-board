import { createTextFetcher } from '../sources/http.js';
import { fetchCandidates } from '../sources/listings.js';

const mode = process.argv[2] ?? 'narrow';
if (mode !== 'narrow' && mode !== 'wide') throw new Error('Mode must be narrow or wide');
const sweep = await fetchCandidates(mode, createTextFetcher());
console.log(JSON.stringify({ mode, observations: sweep.candidates.length, truncated: sweep.truncated,
  sources: sweep.sources.map(({ candidates, ...source }) => ({ ...source, count: candidates.length })) }, null, 2));
if (sweep.sources.every(source => source.failure)) process.exitCode = 1;
