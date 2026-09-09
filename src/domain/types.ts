export const aduStatuses = ['yes', 'no', 'staff', 'unknown'] as const;
export type AduStatus = (typeof aduStatuses)[number];

export const lifecycles = [
  'active',
  'under_contract',
  'needs_verification',
  'ruled_out',
  'gone',
] as const;
export type Lifecycle = (typeof lifecycles)[number];

export interface Evidence {
  kind: string;
  source: string;
  capturedAt: string;
  detail: string;
  confidence?: 'high' | 'medium' | 'low';
  legacyNote?: Record<string, unknown>;
  sourceUrl?: string;
  sourceText?: string;
}

export interface HistoryEntry {
  at: string;
  price?: number;
  lifecycle?: Lifecycle;
  note?: string;
}

export interface Listing {
  id: string;
  address: string;
  price: number;
  bedsBaths: string;
  houseSf: number;
  maxAdu: number;
  adu: AduStatus;
  lifecycle: Lifecycle;
  evidence: Evidence[];
  history: HistoryEntry[];
  updatedAt: string;
  lotSf?: number;
  zoning?: string;
  sourceUrl?: string;
  construction?: string;
  convertibleSpace?: string;
  achievableAdu?: number;
  conversionEstimate?: number;
  conversionStructure?: string;
}

export interface BoardState {
  version: 1;
  importedAt: string;
  listings: Listing[];
}

export interface LegacyRow {
  a: string;
  p?: number | string | null;
  bd?: string | null;
  sf?: number | string | null;
  z?: string | null;
  lot?: number | string | null;
  t?: string | null;
  uc?: boolean | string | null;
  hot?: boolean | string | null;
  dq?: boolean | string | null;
  flag?: string | null;
  note?: string | null;
  fz?: string | null;
  fzAe?: string | null;
  cv?: string | null;
  achv?: number | string | null;
  cc?: number | string | null;
  st?: string | null;
  [key: string]: unknown;
}
