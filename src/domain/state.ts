import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { BoardState } from './types.js';

const evidenceSchema = z.object({
  kind: z.string(),
  source: z.string(),
  capturedAt: z.string(),
  detail: z.string(),
  confidence: z.enum(['high', 'medium', 'low']).optional(),
  legacyNote: z.record(z.unknown()).optional(),
  sourceUrl: z.string().optional(),
  sourceText: z.string().optional(),
});

const lifecycleSchema = z.enum(['active', 'under_contract', 'needs_verification', 'ruled_out', 'gone']);
const listingSchema = z.object({
  id: z.string(),
  address: z.string(),
  price: z.number().finite(),
  bedsBaths: z.string(),
  houseSf: z.number().finite(),
  maxAdu: z.number().finite(),
  adu: z.enum(['yes', 'no', 'staff', 'unknown']),
  lifecycle: lifecycleSchema,
  evidence: z.array(evidenceSchema),
  history: z.array(z.object({
    at: z.string(),
    price: z.number().finite().optional(),
    lifecycle: lifecycleSchema.optional(),
    note: z.string().optional(),
  })),
  updatedAt: z.string(),
  lotSf: z.number().finite().optional(),
  zoning: z.string().optional(),
  sourceUrl: z.string().optional(),
  construction: z.string().optional(),
  convertibleSpace: z.string().optional(),
  achievableAdu: z.number().finite().optional(),
  conversionEstimate: z.number().finite().optional(),
  conversionStructure: z.string().optional(),
});

export const boardStateSchema = z.object({
  version: z.literal(1),
  importedAt: z.string(),
  listings: z.array(listingSchema),
});

export function validateState(state: unknown): BoardState {
  return boardStateSchema.parse(state) as BoardState;
}

export async function writeState(path: string, state: BoardState): Promise<void> {
  const validated = validateState(state);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, path);
}
