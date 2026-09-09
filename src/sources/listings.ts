import { load } from 'cheerio';
import { z } from 'zod';
import { calculateMaxAdu } from '../domain/calculations.js';
import type { Fetcher } from './http.js';

type Mode = 'narrow' | 'wide';
interface Source { source: string; url: string }
const trulia = (area: string): Source => ({ source: 'Trulia', url: `https://www.trulia.com/FL/Saint_Petersburg${area}/` });
export const approvedSources: Record<Mode, Source[]> = {
  narrow: [trulia(',Central_Oak_Park'),
    { source: 'Homes.com', url: 'https://www.homes.com/saint-petersburg-fl/central-oak-park-neighborhood/houses-for-sale/' },
    trulia(',Thirteenth_St_Heights'),
    { source: 'Zillow', url: 'https://www.zillow.com/thirteenth-st-heights-saint-petersburg-fl/' },
    { source: 'Coldwell Banker', url: 'https://www.coldwellbankerhomes.com/fl/saint-petersburg/wildwood-heights/' },
    trulia(',Historic_Kenwood'),
    { source: 'Homes.com', url: 'https://www.homes.com/saint-petersburg-fl/historic-kenwood-neighborhood/houses-for-sale/' }],
  wide: ['33705', '33712', '33713'].flatMap(zip => [trulia(`/${zip}`),
    { source: 'Zillow', url: `https://www.zillow.com/saint-petersburg-fl-${zip}/` }]),
};

export interface ListingCandidate {
  address: string;
  price: number;
  houseSf: number;
  bedsBaths: string;
  maxAdu: number;
  propertyType: 'single_family';
  source: string;
  sourceUrl: string;
  indexUrl: string;
  fetchedAt: string;
  snippet: string;
}
export interface SourceResult extends Source {
  fetchedAt: string;
  candidates: ListingCandidate[];
  failure: string | null;
  pagesFetched: number;
  rejected: number;
}
export interface SourceSweep { mode: Mode; candidates: ListingCandidate[]; sources: SourceResult[]; truncated: boolean }

const residenceSchema = z.object({
  '@type': z.literal('SingleFamilyResidence'),
  address: z.object({ streetAddress: z.string().min(1), addressLocality: z.string(), addressRegion: z.literal('FL') }),
  url: z.string(),
  offers: z.object({ price: z.union([z.number(), z.string()]).transform(Number).pipe(z.number().finite().positive()), priceCurrency: z.literal('USD') }),
  floorSize: z.object({ value: z.union([z.number(), z.string()]).transform(Number).pipe(z.number().finite().positive()), unitCode: z.enum(['FTK', 'SQFT']) }),
  numberOfBedrooms: z.number().nonnegative().optional(),
  numberOfBathroomsTotal: z.number().nonnegative().optional(),
  description: z.string().optional(),
});

// Traverse only recognized schema containers so unrelated recommendations are not mixed in.
function residences(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(residences);
  if (!value || typeof value !== 'object') return [];
  const row = value as Record<string, unknown>;
  if (row['@type'] === 'SingleFamilyResidence') return [row];
  const types = Array.isArray(row['@type']) ? row['@type'] : [row['@type']];
  if (types.includes('RealEstateListing') && row.mainEntity && typeof row.mainEntity === 'object') {
    const home = row.mainEntity as Record<string, unknown>;
    if (home['@type'] === 'SingleFamilyResidence') return [{ ...home, offers: row.offers, url: row.url,
      description: home.description ?? row.description }];
  }
  return ['@graph', 'itemListElement', 'item', 'mainEntity', 'itemOffered'].flatMap(key => residences(row[key]));
}

function scoped(url: string, root: string): boolean {
  const target = new URL(url), base = new URL(root);
  return target.origin === base.origin && target.pathname.startsWith(base.pathname);
}

const truliaSchema = z.object({ props: z.object({ searchData: z.object({
  homes: z.array(z.object({
    location: z.object({ streetAddress: z.string(), city: z.string(), stateCode: z.string() }),
    price: z.object({ price: z.number(), currencyCode: z.string() }), url: z.string(),
    floorSpace: z.object({ formattedDimension: z.string() }).nullable(),
    bedrooms: z.object({ value: z.number().optional() }).nullable(), bathrooms: z.object({ value: z.number().optional() }).nullable(),
    currentStatus: z.object({ isActiveForSale: z.boolean() }),
    tracking: z.array(z.object({ key: z.string(), value: z.string() })),
  })),
  homeCounts: z.object({ agentListingsCount: z.object({ value: z.number() }) }).optional(),
}) }) });

function parsePage(html: string, source: Source, pageUrl: string, fetchedAt: string) {
  const $ = load(html);
  const title = $('title').text();
  if (/access.*denied|request rejected|just a moment|captcha/i.test(title)
    || $('meta[name="description"]').attr('content') === 'px-captcha') throw new Error('Source blocked automated access');
  const records: unknown[] = [];
  let advertisedTotal = 0;
  let recordCount = 0;
  if (source.source === 'Trulia' && $('#__NEXT_DATA__').length) {
    const data = truliaSchema.parse(JSON.parse($('#__NEXT_DATA__').text())).props.searchData;
    advertisedTotal = data.homeCounts?.agentListingsCount.value ?? 0;
    recordCount = data.homes.length;
    for (const home of data.homes) {
      if (!home.currentStatus.isActiveForSale || !home.tracking.some(item => item.key === 'propertyType' && item.value === 'single-family home')) continue;
      const area = home.floorSpace?.formattedDimension.match(/^([\d,]+) sqft$/);
      records.push({ '@type': 'SingleFamilyResidence',
        address: { streetAddress: home.location.streetAddress, addressLocality: home.location.city, addressRegion: home.location.stateCode },
        url: home.url, offers: { price: home.price.price, priceCurrency: home.price.currencyCode },
        floorSize: { value: area ? Number(area[1].replaceAll(',', '')) : 0, unitCode: 'FTK' },
        numberOfBedrooms: home.bedrooms?.value, numberOfBathroomsTotal: home.bathrooms?.value,
        description: home.tracking.find(item => item.key === 'item')?.value ?? '' });
    }
  }
  $('script[type="application/ld+json"]').each((_, element) => {
    try { records.push(...residences(JSON.parse($(element).text()))); } catch { /* Other scripts may be unrelated or malformed. */ }
  });
  if (!records.length) throw new Error('No supported listing records; page format or access needs verification');
  let rejected = 0;
  const candidates: ListingCandidate[] = [];
  for (const record of records) {
    const parsed = residenceSchema.safeParse(record);
    if (!parsed.success) { rejected++; continue; }
    const row = parsed.data;
    if (row.offers.price > 437000 || !/^(saint|st\.?) petersburg$/i.test(row.address.addressLocality)) { rejected++; continue; }
    let url: URL;
    try { url = new URL(row.url, pageUrl); } catch { rejected++; continue; }
    if (url.protocol !== 'https:' || url.origin !== new URL(source.url).origin) { rejected++; continue; }
    candidates.push({ address: row.address.streetAddress.trim(), price: row.offers.price,
      houseSf: row.floorSize.value, maxAdu: calculateMaxAdu(row.floorSize.value),
      bedsBaths: `${row.numberOfBedrooms ?? '?'}/${row.numberOfBathroomsTotal ?? '?'}`,
      propertyType: 'single_family', source: source.source, sourceUrl: url.href,
      indexUrl: pageUrl, fetchedAt, snippet: row.description ?? '' });
  }
  let next = $('a[rel~="next"],link[rel~="next"]').first().attr('href');
  if (!next && source.source === 'Trulia') {
    const currentPage = Number(new URL(pageUrl).pathname.match(/\/(\d+)_p\/$/)?.[1] ?? 1);
    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      if (!href) return;
      const url = new URL(href, pageUrl);
      if (scoped(url.href, source.url) && url.pathname === new URL(source.url).pathname + `${currentPage + 1}_p/`) next = url.href;
    });
  }
  return { candidates, rejected, next: next ? new URL(next, pageUrl).href : null, advertisedTotal, recordCount };
}

export async function fetchCandidates(mode: Mode, fetcher: Fetcher): Promise<SourceSweep> {
  const sources: SourceResult[] = [];
  for (const source of approvedSources[mode]) {
    const result: SourceResult = { ...source, fetchedAt: new Date().toISOString(), candidates: [], failure: null, pagesFetched: 0, rejected: 0 };
    const visited = new Set<string>();
    let advertisedTotal = 0;
    let recordCount = 0;
    let page: string | null = source.url;
    try {
      while (page) {
        if (page.length > 250 || !scoped(page, source.url)) throw new Error('Pagination outside approved scope or URL budget');
        if (visited.has(page) || visited.size >= 3) throw new Error('Pagination incomplete: loop or three-page limit');
        visited.add(page);
        const response = await fetcher(page);
        result.pagesFetched++;
        if (!response.ok) throw new Error(response.error);
        if (response.finalUrl && !scoped(response.finalUrl, source.url)) throw new Error('Source redirected outside approved scope');
        if (typeof response.data !== 'string') throw new Error('Expected HTML; use createTextFetcher');
        const parsed = parsePage(response.data, source, page, result.fetchedAt);
        result.candidates.push(...parsed.candidates);
        result.rejected += parsed.rejected;
        advertisedTotal = Math.max(advertisedTotal, parsed.advertisedTotal);
        recordCount += parsed.recordCount;
        page = parsed.next;
      }
      if (advertisedTotal > recordCount) result.failure = 'Pagination incomplete: advertised total exceeds retrieved records';
    } catch (error) {
      result.failure = error instanceof Error ? error.message : String(error);
    }
    sources.push(result);
  }
  const observations = [...new Map(sources.flatMap(source => source.candidates)
    .map(candidate => [`${candidate.sourceUrl}|${candidate.price}`, candidate])).values()];
  observations.sort((a, b) => b.maxAdu - a.maxAdu || a.price - b.price || a.address.localeCompare(b.address));
  const key = (row: ListingCandidate) => row.address.toUpperCase().replace(/\s+/g, ' ').trim();
  const addresses = [...new Set(observations.map(key))];
  const allowed = new Set(addresses.slice(0, mode === 'narrow' ? 25 : 35));
  return { mode, candidates: observations.filter(row => allowed.has(key(row))), sources, truncated: addresses.length > allowed.size };
}
