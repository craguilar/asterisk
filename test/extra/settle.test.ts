import { describe,it,expect } from 'vitest';
import { readFinals } from '../../src/settle.js';

const event='KXLIGAMXGAME-26NOV07TOLMON', kickoff='2026-11-07T23:00:00Z', end=Date.parse(kickoff)/1000;
const markets=['TOL','TIE','MON'].map(suffix=>({ticker:event+'-'+suffix,event,kickoff}));
function transport(prices:(number|null)[],status='finalized',resultOverride?:string):typeof fetch {
  return async(input,init)=>{
    const request=new Request(input,init), url=new URL(request.url);
    expect(request.method).toBe('GET');expect(request.redirect).toBe('error');
    expect(url.host).toBe('api.elections.kalshi.com');
    const m=markets.find(m=>url.pathname.includes(m.ticker))!, i=markets.indexOf(m);
    if (url.pathname.endsWith('candlesticks')) {
      return Response.json({ticker:m.ticker,candlesticks:[
        {end_period_ts:end-60,yes_ask:{close_dollars:prices[i]?.toString()??null}},
        {end_period_ts:end+60,yes_ask:{close_dollars:'0.99'}}]});
    }
    return Response.json({market:{ticker:m.ticker,event_ticker:event,status,result:resultOverride??(i===0?'yes':'no'),
      settlement_ts:'2026-11-08T01:12:00Z',settlement_value_dollars:i===0?'1.0000':'0.0000'}});
  };
}
describe('official settlements',()=>{
  it('waits for every sibling when the exchange publishes its finals in stages',async()=>{
    const base=transport([.52,.27,.26]);
    const partial=await readFinals(markets,(input,init)=>String(input).endsWith('-MON')
      ?transport([],'closed')(input,init):base(input,init));
    expect(partial).toEqual([]);
    expect(await readFinals(markets.slice(0,2),base)).toEqual([]);
  });
  it('deduplicates tickers and normalizes the last complete set of pre-kickoff asks',async()=>{
    const rows=await readFinals([...markets,markets[0]!],transport([.52,.27,.26]));
    expect(rows.map(r=>r.outcome)).toEqual([1,0,0]);expect(rows[0]!.closingPrior).toBeCloseTo(.52/1.05);
  });
  it('leaves CLV missing for an incomplete candle set but retains official results',async()=>{
    expect((await readFinals(markets,transport([null,.2,.3]))).every(r=>r.closingPrior===null)).toBe(true);
  });
  it('accepts archived dollar strings from the historical candlestick endpoint',async()=>{
    const base=transport([.5,.25,.25]);
    const rows=await readFinals(markets,async(input,init)=>{
      const u=new URL(String(input));
      if (!u.pathname.endsWith('candlesticks')) return base(input,init);
      if (!u.pathname.includes('/historical/')) return new Response(null,{status:404});
      return Response.json({ticker:markets.find(m=>u.pathname.includes(m.ticker))!.ticker,
        candlesticks:[{end_period_ts:end-60,yes_ask:{close:'0.4000'}}]});
    });
    expect(rows[0]!.closingPrior).toBeCloseTo(1/3);
  });
  it('skips markets with pending or non-binary settlements',async()=>{
    expect(await readFinals(markets,transport([], 'closed'))).toEqual([]);
    expect(await readFinals(markets,transport([], 'finalized','scalar'))).toEqual([]);
  });
  it('keeps official settlement evidence during price-history outages',async()=>{
    const base=transport([.4,.3,.3]);
    const rows=await readFinals(markets,(input,init)=>String(input).includes('/candlesticks')
      ?Promise.resolve(new Response(null,{status:503})):base(input,init));
    expect(rows).toHaveLength(3);
    expect(rows.every(r=>r.closingPrior===null && r.closingNote==='price_history_unavailable')).toBe(true);
  });
  it('rejects malformed input before contacting the upstream',async()=>{
    let calls=0;
    await expect(readFinals([{...markets[0]!,ticker:event+'-/bad'}],async()=>{calls++;throw Error();})).rejects.toThrow('identifier');
    expect(calls).toBe(0);
  });
});
