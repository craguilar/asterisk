import { setTimeout as delay } from 'node:timers/promises';

export const SERIES = 'KXLIGAMXGAME';
export const MARKETS_URL = 'https://api.elections.kalshi.com/trade-api/v2/markets';
export function regulationRules(text:string) {
  const normalized=text.toLowerCase().replace(/(?:does not include|excluding|excludes) extra time (?:or|and) penalt(?:ies|y kicks)/g,'');
  return /\b(?:90 minutes|regulation time)\b/.test(normalized) &&
    !/\b(?:extra time|overtime|penalt(?:ies|y kicks)|shootout|advance[s]?)\b/.test(normalized);
}
export interface Quote {
  ticker: string; event: string; label: string; title: string; status: string; rules: string;
  updated: string; marketUpdated?:string; open: string; close: string; bid: number | null; ask: number | null;
  last: number | null; askSize: number | null; volume: number | null;
}
function object(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function decimal(v: unknown, max = Infinity) {
  if (typeof v !== 'number' && (typeof v !== 'string' || !/^\d+(?:\.\d+)?$/.test(v))) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
}
function parse(v: unknown, series: string, observedAt:string): Quote {
  if (!object(v)) throw new Error('Invalid Kalshi market');
  const str = (k: string) => typeof v[k] === 'string' ? v[k] as string : '';
  const event = str('event_ticker'), ticker = str('ticker');
  if (!event.startsWith(series + '-') || !ticker.startsWith(event + '-') || v.market_type !== 'binary') throw new Error('Unexpected series or contract type');
  return { ticker, event, label: str('yes_sub_title'), title: str('title'), status: str('status'), rules: str('rules_primary'),
    updated: observedAt, marketUpdated:str('updated_time'), open: str('open_time'), close: str('close_time'),
    bid: decimal(v.yes_bid_dollars, 1), ask: decimal(v.yes_ask_dollars, 1), last: decimal(v.last_price_dollars, 1),
    volume: decimal(v.volume_fp), askSize: decimal(v.yes_ask_size_fp) };
}
export async function readMarkets(series: string, fetchImpl: typeof fetch = fetch): Promise<Quote[]> {
  if (!/^[A-Z0-9]{2,40}$/.test(series)) throw new Error('Invalid Kalshi series');
  const rows: Quote[] = [], ticks = new Set<string>(), cursors = new Set<string>();
  const deadline = AbortSignal.timeout(25_000);
  let cursor = '';
  for (let page = 0; page < 25; page++) {
    const url = new URL(MARKETS_URL);
    url.searchParams.set('series_ticker', series);
    url.searchParams.set('status', 'open');
    url.searchParams.set('limit', '200');
    if (cursor) url.searchParams.set('cursor', cursor);
    let response: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: deadline });
      if (response.ok || (response.status !== 429 && response.status < 500) || attempt === 2) break;
      const retry = Number(response.headers.get('retry-after'));
      await response.body?.cancel();
      // Longer upstream backoff needs a later scheduler retry, not an early request.
      if (retry > 3) throw new Error('Kalshi rate limited');
      await delay(Math.max(retry * 1000 || 0, 200 * 2 ** attempt), undefined, { signal: deadline });
    }
    if (!response?.ok) throw new Error('Kalshi HTTP ' + response?.status);
    const observedAt = new Date().toISOString();
    const body: unknown = await response.json();
    if (!object(body) || !Array.isArray(body.markets) || typeof body.cursor !== 'string') throw new Error('Invalid Kalshi market page');
    for (const record of body.markets) {
      const quote = parse(record, series, observedAt);
      if (ticks.has(quote.ticker)) throw new Error('Inconsistent Kalshi market pagination');
      ticks.add(quote.ticker); rows.push(quote);
    }
    cursor = body.cursor;
    if (!cursor) return rows;
    if (cursors.has(cursor)) throw new Error('Repeated Kalshi cursor');
    cursors.add(cursor);
  }
  throw new Error('Kalshi pagination limit reached');
}
