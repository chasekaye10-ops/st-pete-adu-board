import { createHash } from 'node:crypto';
import { z } from 'zod';
import { calculateMaxAdu } from '../domain/calculations.js';
import type { AduStatus, BoardState, Evidence, LegacyRow, Lifecycle, Listing } from '../domain/types.js';

const legacyRowSchema = z.object({
  a: z.string({ required_error: 'address is required', invalid_type_error: 'address is required' })
    .trim()
    .min(1, 'address is required'),
}).passthrough();
const legacyRowsSchema = z.array(legacyRowSchema);

export function parseLegacyRows(rows: unknown): LegacyRow[] {
  return legacyRowsSchema.parse(rows) as LegacyRow[];
}

function text(value: unknown, fallback = ''): string {
  return value === null || value === undefined ? fallback : String(value).trim();
}

function numberValue(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(text(value).replace(/[$,]/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isTruthy(value: unknown): boolean {
  return value === true || ['1', 'true', 'yes', 'y', 'x'].includes(text(value).toLowerCase());
}

function stableId(address: string): string {
  return `listing-${createHash('sha1').update(address.toLowerCase()).digest('hex').slice(0, 12)}`;
}

function mapAdu(row: LegacyRow): AduStatus {
  if (['strong', 'eligible'].includes(text(row.t).toLowerCase())) return 'yes';
  return 'unknown';
}

function mapLifecycle(row: LegacyRow): Lifecycle {
  if (isTruthy(row.uc)) return 'under_contract';
  if (isTruthy(row.dq) || row.t === 'out') return 'ruled_out';
  if (['zip', 'unverified'].includes(text(row.t))) return 'needs_verification';
  return 'active';
}

function legacyEvidence(row: LegacyRow, importedAt: string): Evidence {
  const details = Object.entries(row)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join('; ');
  return {
    kind: 'legacyNote',
    source: 'legacy-board-export',
    capturedAt: importedAt,
    detail: details,
    confidence: 'medium',
    legacyNote: { ...row },
  };
}

export function importLegacy(rows: LegacyRow[], importedAt: string): BoardState {
  const listings: Listing[] = parseLegacyRows(rows).map((row) => {
    const address = text(row.a);
    const houseSf = numberValue(row.sf);
    const price = numberValue(row.p);
    const listing: Listing = {
      id: stableId(address),
      address,
      price,
      bedsBaths: text(row.bd),
      houseSf,
      maxAdu: calculateMaxAdu(houseSf),
      adu: mapAdu(row),
      lifecycle: mapLifecycle(row),
      evidence: [legacyEvidence(row, importedAt)],
      history: [{ at: importedAt, price, lifecycle: mapLifecycle(row) }],
      updatedAt: importedAt,
    };

    if (row.lot !== null && row.lot !== undefined && row.lot !== '') listing.lotSf = numberValue(row.lot);
    if (text(row.z)) listing.zoning = text(row.z);
    if (text(row.fz)) listing.evidence.push({ kind: 'flood', source: 'legacy-board-export', capturedAt: importedAt, detail: text(row.fz) });
    if (text(row.fzAe)) listing.evidence.push({ kind: 'flood', source: 'legacy-board-export', capturedAt: importedAt, detail: text(row.fzAe) });
    if (text(row.cv)) listing.convertibleSpace = text(row.cv);
    if (row.achv !== null && row.achv !== undefined && row.achv !== '') listing.achievableAdu = numberValue(row.achv);
    if (text(row.cc)) listing.conversionEstimate = numberValue(row.cc);
    if (text(row.st)) listing.conversionStructure = text(row.st);

    return listing;
  });

  return { version: 1, importedAt, listings };
}
