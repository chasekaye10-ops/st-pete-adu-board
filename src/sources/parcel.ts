import { z } from 'zod';
import type { AduStatus } from '../domain/types.js';
import type { Fetcher } from './http.js';

const endpoint = 'https://services2.arcgis.com/9qPLjNtocjo438CJ/arcgis/rest/services/NT_Zoning_ADU/FeatureServer/0';
const fields = ['ADDRESS', 'ZONING', 'NTCRIT', 'SQFT', 'CRITERIA'];
const attributes = z.object({ ADDRESS: z.string(), ZONING: z.string().nullable(),
  NTCRIT: z.string().nullable(), SQFT: z.number().finite().nonnegative().nullable(), CRITERIA: z.string().nullable() });
const responseSchema = z.object({ features: z.array(z.object({ attributes })), exceededTransferLimit: z.boolean().optional() });

export interface ParcelLookup {
  adu: AduStatus;
  ambiguous: boolean;
  checkedAt: string;
  url?: string;
  matchedAddress?: string;
  zoning?: string | null;
  reason?: string | null;
  criteria?: string | null;
  lotSf?: number | null;
  areaNote?: string;
  returnedCount?: number;
  error?: string;
}
export interface ParcelSelfTest { ok: boolean; error?: string; parcel?: ParcelLookup }

export function mapCriteria(value: string | null): AduStatus {
  switch (value) {
    case 'Meets criteria for ADU': return 'yes';
    case 'Does not meet criteria': return 'no';
    case 'Contact city staff': return 'staff';
    default: return 'unknown';
  }
}

function normalize(address: string): string {
  const types: Record<string, string> = { STREET: 'ST', AVENUE: 'AVE', ROAD: 'RD', DRIVE: 'DR', COURT: 'CT', PLACE: 'PL', TERRACE: 'TER', BOULEVARD: 'BLVD' };
  return address.toUpperCase().split(',')[0]
    .replace(/\s+(?:SAINT|ST\.?)\s+PETERSBURG\b.*$/, '')
    .replace(/\s+(?:APT|UNIT|#).*$/, '').replace(/\./g, '')
    .replace(/\b(STREET|AVENUE|ROAD|DRIVE|COURT|PLACE|TERRACE|BOULEVARD)\b/g, word => types[word])
    .replace(/\s+/g, ' ').trim();
}

export async function lookupParcel(address: string, fetcher: Fetcher): Promise<ParcelLookup> {
  const result: ParcelLookup = { adu: 'unknown', ambiguous: false, checkedAt: new Date().toISOString() };
  try {
    const normalized = normalize(address);
    const parts = normalized.match(/^(\d+) ([A-Z0-9]+)(?: |$)/);
    if (!parts) throw new Error('Unsupported address format');
    const pattern = `${parts[1]}%${parts[2]}%`;
    result.url = `${endpoint}/query?where=ADDRESS%20LIKE%20%27${encodeURIComponent(pattern)}%27&outFields=${fields.join(',')}&returnGeometry=false&f=json`;
    if (result.url.length > 250) throw new Error('Parcel URL exceeds 250 characters');
    const response = await fetcher(result.url);
    if (!response.ok) throw new Error(response.error);
    const parsed = responseSchema.parse(response.data);
    if (parsed.exceededTransferLimit) throw new Error('Incomplete parcel response');
    result.returnedCount = parsed.features.length;
    const matches = parsed.features.filter(feature => normalize(feature.attributes.ADDRESS) === normalized);
    if (matches.length !== 1) {
      result.ambiguous = matches.length > 1 || (matches.length === 0 && parsed.features.length > 1);
      throw new Error(matches.length > 1 ? 'Duplicate exact address matches' : 'No exact address match');
    }
    const row = matches[0].attributes;
    result.adu = mapCriteria(row.CRITERIA);
    result.matchedAddress = row.ADDRESS;
    result.zoning = row.ZONING;
    result.reason = row.NTCRIT;
    result.criteria = row.CRITERIA;
    result.lotSf = row.SQFT === 0 ? null : row.SQFT;
    if (row.SQFT === 0 && result.adu === 'yes') result.areaNote = 'Qualifies by zoning; lot area not applicable';
    if (result.adu === 'unknown') result.error = 'Unrecognized or missing CRITERIA verdict';
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  return result;
}

export async function selfTestParcelApi(fetcher: Fetcher): Promise<ParcelSelfTest> {
  try {
    const response = await fetcher(`${endpoint}?f=json`);
    if (!response.ok) throw new Error(response.error);
    const schema = z.object({ fields: z.array(z.object({ name: z.string() })) }).parse(response.data);
    const missing = fields.filter(name => !schema.fields.some(field => field.name === name));
    if (missing.length) throw new Error(`Missing schema fields: ${missing.join(', ')}`);
    const parcel = await lookupParcel('1521 12th St S', fetcher);
    const ok = parcel.returnedCount === 1 && parcel.adu === 'yes' && parcel.zoning === 'NT-2'
      && parcel.lotSf != null && Math.abs(parcel.lotSf - 6225) <= 1;
    return { ok, parcel, ...(ok ? {} : { error: parcel.error ?? 'Known parcel did not match expected values' }) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
