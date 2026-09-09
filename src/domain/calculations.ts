import type { Listing } from './types.js';

export function calculateMaxAdu(houseSf: number): number {
  return Math.min(800, Math.round(houseSf * 0.67));
}

// Existing board assumption, before property-specific renovation or rental adjustments.
export function calculateAnnualCarry(price: number): number {
  return Math.round(33424 + 0.09619 * (price - 279900));
}

export function isVerifiedFloodX(listing: Listing): boolean {
  const evidence = listing.evidence.filter(item => item.kind === 'flood');
  // Conflicting zones need review; an old X citation must not hide an AE finding.
  if (evidence.some(item => /\b(?:AE|VE|A|V)\b/.test(item.detail))) return false;
  return evidence.some(item => item.source === 'legacy-board-export'
    && /^Zone X\s*[—-]\s*property record, not listing copy\s*$/i.test(item.detail));
}

function hasConfirmedStructure(listing: Listing): number {
  const structure = listing.conversionStructure ?? '';
  return Number(structure.trim().length > 0
    && !/\b(?:assumed|possible|potential|unknown|unverified|no|not)\b|\?/i.test(structure));
}

function constructionRank(listing: Listing): number {
  // Imported descriptions use a distinct material segment; do not infer it from siding.
  const material = listing.construction?.trim().toLowerCase()
    ?? listing.convertibleSpace?.match(/(?:^|·)\s*(block|frame)(?=\s*[,·]|$)/i)?.[1].toLowerCase();
  return material === 'block' ? 0 : material === 'frame' ? 1 : 2;
}

export function rankListings(listings: Listing[]): Listing[] {
  const eligibility = { yes: 0, staff: 1, unknown: 2, no: 3 };
  return listings.filter(listing => listing.lifecycle === 'active').sort((a, b) =>
    eligibility[a.adu] - eligibility[b.adu]
    || b.maxAdu - a.maxAdu
    || Number(isVerifiedFloodX(b)) - Number(isVerifiedFloodX(a))
    || hasConfirmedStructure(b) - hasConfirmedStructure(a)
    || (b.achievableAdu ?? 0) - (a.achievableAdu ?? 0)
    || constructionRank(a) - constructionRank(b)
    || a.price - b.price
    || a.id.localeCompare(b.id));
}
