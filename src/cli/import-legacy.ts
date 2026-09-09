import { readFile } from 'node:fs/promises';
import { importLegacy, parseLegacyRows } from '../import/legacy.js';
import { writeState } from '../domain/state.js';

const [inputPath, outputPath, importedAt] = process.argv.slice(2);
if (!inputPath || !outputPath || !importedAt) {
  throw new Error('Usage: npx tsx src/cli/import-legacy.ts <input.json> <output.json> <YYYY-MM-DD>');
}

const parsed: unknown = JSON.parse(await readFile(inputPath, 'utf8'));
const rows = Array.isArray(parsed)
  ? parsed
  : typeof parsed === 'object' && parsed !== null && 'rows' in parsed
    ? (parsed as { rows: unknown }).rows
    : null;
if (!Array.isArray(rows)) throw new Error('Legacy input must be a JSON array or an object with a rows array');

const state = importLegacy(parseLegacyRows(rows), importedAt);
await writeState(outputPath, state);
console.log(`Imported ${state.listings.length} listings into ${outputPath}`);
