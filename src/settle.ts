import { z } from 'zod';
import { MARKETS_URL, SERIES } from './kalshi.js';
import { normalize } from './math.js';

interface TrackedMarket {ticker:string; event:string; kickoff:string|null}
export interface FinalReading {ticker:string;outcome:0|1;closingPrior:number|null;settledAt:string;source:string;closingNote?:string}
const host=MARKETS_URL.slice(0,-'/markets'.length);
const responseSchema=z.object({market:z.object({ticker:z.string(),event_ticker:z.string(),status:z.string(),result:z.string().nullable().optional(),
  settlement_ts:z.string().nullable().optional(),settlement_value_dollars:z.string().nullable().optional()})});
const candlesSchema=z.object({ticker:z.string(),candlesticks:z.array(z.object({
  end_period_ts:z.number(), yes_ask:z.object({close_dollars:z.string().nullable().optional(),close:z.string().nullable().optional()}).nullish(),
}))});
async function read(url:string, fetchImpl:typeof fetch) {
  const response=await fetchImpl(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(8000)});
  if (response.status===404) return null;
  if (!response.ok) throw new Error('Kalshi settlement read returned HTTP '+response.status);
  return await response.json() as unknown;
}
async function official(m:TrackedMarket,fetchImpl:typeof fetch):Promise<FinalReading|null> {
  let source=MARKETS_URL+'/'+m.ticker;
  let body=await read(source,fetchImpl);
  if (!body) { source=host+'/historical/markets/'+m.ticker; body=await read(source,fetchImpl); }
  if (!body) return null;
  const record=responseSchema.parse(body).market;
  if (record.ticker!==m.ticker || record.event_ticker!==m.event) throw new Error('Kalshi settlement identity mismatch');
  if (record.status!=='finalized' || (record.result!=='yes' && record.result!=='no')) return null;
  const outcome=record.result==='yes'?1:0;
  if (record.settlement_value_dollars !== undefined &&
      (record.settlement_value_dollars===null || !/^\d+(?:\.\d+)?$/.test(record.settlement_value_dollars) || Number(record.settlement_value_dollars)!==outcome)) return null;
  if (!record.settlement_ts || !Number.isFinite(Date.parse(record.settlement_ts))) return null;
  return {ticker:m.ticker,outcome,closingPrior:null,settledAt:new Date(record.settlement_ts).toISOString(),source};
}
async function candlePrices(m:TrackedMarket,end:number,fetchImpl:typeof fetch) {
  const query='?'+new URLSearchParams({start_ts:String(end-1800),end_ts:String(end),period_interval:'1'});
  const tail=m.ticker+'/candlesticks'+query;
  let body=await read(host+'/series/'+SERIES+'/markets/'+tail,fetchImpl);
  if (!body) body=await read(host+'/historical/markets/'+tail,fetchImpl);
  const quotes=new Map<number,number>();
  if (!body) return quotes;
  const data=candlesSchema.parse(body);
  if (data.ticker!==m.ticker) throw new Error('Kalshi candle identity mismatch');
  for (const candle of data.candlesticks) {
    const raw=candle.yes_ask?.close_dollars??candle.yes_ask?.close, value=Number(raw);
    if (!raw || !/^\d+(?:\.\d+)?$/.test(raw) || !(value>0 && value<1)) continue;
    if (candle.end_period_ts<end && candle.end_period_ts>=end-1800) quotes.set(candle.end_period_ts,value);
  }
  return quotes;
}
export async function readFinals(markets:TrackedMarket[], fetchImpl:typeof fetch=fetch):Promise<FinalReading[]> {
  const events=new Map<string,Map<string,TrackedMarket>>();
  for (const m of markets) {
    if (!/^KXLIGAMXGAME-[A-Z0-9]{8,32}$/.test(m.event) || !m.ticker.startsWith(m.event+'-') ||
        !/^[A-Z0-9]{2,10}$/.test(m.ticker.slice(m.event.length+1))) throw new Error('Invalid settlement market identifier');
    const group=events.get(m.event)??new Map<string,TrackedMarket>();
    const previous=group.get(m.ticker);
    if (previous && previous.kickoff!==m.kickoff) throw new Error('Conflicting kickoff for a tracked market');
    group.set(m.ticker,m); events.set(m.event,group);
  }
  const finals:FinalReading[]=[];
  for (const group of events.values()) {
    const tracked=[...group.values()];
    if (tracked.length>3 || new Set(tracked.map(m=>m.kickoff)).size>1) throw new Error('Inconsistent three-way event');
    if (tracked.length!==3) continue;
    const confirmed=(await Promise.all(tracked.map(m=>official(m,fetchImpl)))).filter((r):r is FinalReading=>r!==null);
    if (confirmed.length!==3) continue;
    if (confirmed.filter(r=>r.outcome===1).length!==1) throw new Error('Inconsistent binary settlements');
    const kickoff=tracked[0]?.kickoff;
    if (kickoff && Number.isFinite(Date.parse(kickoff))) {
      const end=Math.floor(Date.parse(kickoff)/1000);
      if (confirmed.some(r=>Date.parse(r.settledAt)<=end*1000)) throw new Error('Settlement predates kickoff');
      // Price history may be missing. A final exchange result remains independently usable.
      try {
        const histories=await Promise.all(tracked.map(m=>candlePrices(m,end,fetchImpl)));
        const common=[...histories[0]!.keys()].filter(t=>histories.every(h=>h.has(t))).sort((a,b)=>b-a)[0];
        if (common!==undefined) {
          const priors=normalize(histories.map(h=>h.get(common)!));
          confirmed.forEach((r,i)=>{r.closingPrior=priors[i]!;});
        } else confirmed.forEach(r=>{r.closingNote='no_common_pre_kickoff_quote';});
      } catch {
        confirmed.forEach(r=>{r.closingNote='price_history_unavailable';});
      }
    }
    finals.push(...confirmed);
  }
  return finals;
}
