# Listing sources and analysis

The approved URL inventory lives in `src/sources/listings.ts`.

Narrow mode uses Trulia Central Oak Park, Thirteenth St Heights and Historic
Kenwood; Homes.com Central Oak Park and Historic Kenwood; Zillow Thirteenth
St Heights; and Coldwell Banker Wildwood Heights. Wide mode uses Trulia and
Zillow ZIP indexes for 33705, 33712 and 33713. The caller must authorize wide mode
after the parcel self-test and narrow-sweep gate. This module never widens itself.
Redfin, BEX and the citywide-redirecting Trulia Wildwood URL are excluded.

## Supported format and current limits

The adapters read Trulia's native `props.searchData.homes` records and schema.org
JSON-LD `SingleFamilyResidence` records, including Coldwell Banker's parent
`RealEstateListing` offers and `ItemList` containers. They require an explicit single-family
type, St. Petersburg/Florida address, positive square-foot area in FTK/SQFT,
USD asking price and same-origin listing URL. The price cap is $437,000.
Unsupported markup, access-denial pages and redirects outside the selected
index scope produce diagnostics. There are no guessed site-specific CSS selectors.

The general fixture is synthetic and labeled as such. `trulia-card.html` and
`coldwell-card.html` are reduced from actual returned records; they omit session,
agent, image and unrelated data. Initial curl probes were blocked, but the
application's ordinary fetch requests returned usable pages without any challenge
bypass. The final diagnostic on 2026-09-08 Eastern returned:

| Index | Result |
| --- | --- |
| Trulia Central Oak Park | 20 accepted observations across 2 pages |
| Trulia Thirteenth St Heights | 4 accepted observations |
| Coldwell Banker Wildwood Heights | 5 accepted observations |
| Homes.com, both indexes | HTTP 403 |
| Zillow Thirteenth St Heights | Unsupported returned page format |
| Trulia Historic Kenwood | Response exceeded 2 MB limit |

After deduplication and the address cap, 26 observations for 25 selected address
keys remained (multiple source prices are retained). These are observations,
not confirmed new or ADU-eligible properties. No board records were changed.
Wide indexes are configured but not live-verified. The deployment environment
must be checked again before scheduling. Unsupported representations need adapters
based on actual responses; do not work around access controls.

Pagination follows explicit rel=next links or observed Trulia numbered page links within the same origin and index
path, up to three pages. Loops, out-of-scope links and incomplete pagination are
reported as failures while already parsed observations remain available. Trulia's
advertised total is checked against the number of records retrieved. URLs
are limited to 250 characters; requests to 15 seconds and 2 MB of actual bytes.
No detail pages are fetched, so the two-detail-page budget is unused.

Candidates are capped at 25 unique addresses in narrow mode and 35 in wide mode,
by legal maximum ADU descending then price ascending. Different price observations
remain associated with their source URLs. This module does not update durable
state, infer a price change, confirm a delisting or remove a property. The later
merge stage must compare observations with history and resolve conflicts.

## Diagnostics

Run `npm run check:sources` or `npm run check:sources -- wide` to check the source
inventory. The command reports counts, pages, rejected records and failures;
it does not write `data/state.json` or call OpenAI. An all-failed sweep exits 1.
The dashboard and scheduled scan are not yet connected.

## Optional evidence analysis

Configure `OPENAI_API_KEY` and `OPENAI_MODEL` in the server environment. With
either missing, `createOpenAiClient()` returns null and analysis returns unknown
evidence with a diagnostic. Never put these values in the generated website.
No paid model requests were made during implementation.

The official OpenAI SDK uses structured output with exactly seven fields:
convertibleStatus, convertibleDetail, construction, flood, listingStatus,
confidence, evidenceQuote. Output is independently validated, and a nonempty
quote must occur verbatim in the input snippet. Every result retains sourceUrl,
snippet and capturedAt. A matching quote does not independently prove every
model interpretation; model results remain interpretations of listing text.
Flood claims must not be promoted to verified FEMA evidence by downstream code.
Requests have a 30-second timeout, at most one retry, and store=false.

## Dependency check

The installation audit identified two moderate advisories in the pre-existing
Vitest 3 development dependency and its mocker package (GHSA-82fw-gwwq-j7x9).
The proposed remediation is a major test-runner upgrade, deferred from this
adapter change. No production dependencies were identified by this audit.
