import { describe, expect, it } from 'vitest';
import { readMarkets } from '../src/kalshi.js';

const series = 'KXLIGAMXGAME';
function market(suffix: string, ask: string | null) {
  return {
    ticker: series + '-26NOV23AMETOL-' + suffix,
    event_ticker: series + '-26NOV23AMETOL',
    market_type: 'binary', title: 'América vs. Toluca', yes_sub_title: suffix,
    status: 'active', yes_ask_dollars: ask, yes_bid_dollars: '0.4100',
    last_price_dollars: '0.4200', volume_fp: '100.00', liquidity_dollars: '25.00',
    open_time: '2026-11-20T19:00:00Z', close_time: '2026-11-24T19:00:00Z',
    updated_time: '2026-11-23T19:00:00Z', rules_primary: 'Regulation time including stoppage time.',
  };
}

describe('read-only Kalshi discovery', () => {
  it('uses only the public markets GET route, carrying the cursor and retaining missing quotes', async () => {
    const requests: Request[] = [];
    const fetchPage: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (requests.length > 2) throw Error('Unexpected third page');
      return Response.json(requests.length === 1
        ? { markets: [market('AME', '0.5300')], cursor: 'page-two' }
        : { markets: [market('TOL', null)], cursor: '' });
    };
    const markets = await readMarkets(series, fetchPage);
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      const url = new URL(request.url);
      expect(request.method).toBe('GET');
      expect(url.protocol).toBe('https:');
      expect(url.pathname).toBe('/trade-api/v2/markets');
      expect(url.searchParams.get('series_ticker')).toBe(series);
      expect(request.headers.has('authorization')).toBe(false);
    }
    expect(new URL(requests[1]!.url).searchParams.get('cursor')).toBe('page-two');
    expect(markets.map(({ ticker, ask }) => ({ ticker, ask }))).toEqual([
      { ticker: market('AME', '').ticker, ask: 0.53 },
      { ticker: market('TOL', '').ticker, ask: null },
    ]);
  });

  it('returns a genuine empty market day', async () => {
    const fetchPage: typeof fetch = async () => Response.json({ markets: [], cursor: '' });
    expect(await readMarkets(series, fetchPage)).toEqual([]);
  });

  it('surfaces upstream failure without inventing fixture markets', async () => {
    const fetchPage: typeof fetch = async () => new Response('', { status: 403 });
    await expect(readMarkets(series, fetchPage)).rejects.toThrow();
  });
});
