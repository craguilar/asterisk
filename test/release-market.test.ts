import {it,expect,vi} from 'vitest';
import {readMarkets,SERIES} from '../src/kalshi.js';
import {evaluateQuotes,loadPaperConfig} from '../src/pipeline.js';
import {consult} from '../src/agent.js';
const at=new Date('2026-11-28T20:00:00.000Z'),kickoff='2026-11-29T01:00:00Z';
const event=SERIES+'-26NOV28ATLTOL';
const match={home:'Atlas',away:'Toluca',aliasesHome:[],aliasesAway:[],lambdaHome:1.6,lambdaAway:1,rho:0,kickoff};
const labels=['Atlas','Tie','Toluca'];
const payload=labels.map((label,i)=>({ticker:event+'-'+i,event_ticker:event,market_type:'binary',yes_sub_title:label,title:label,status:'active',yes_ask_dollars:['0.52','0.26','0.27'][i],yes_bid_dollars:'0.10',yes_ask_size_fp:'30.00',open_time:'2026-11-20T00:00:00Z',close_time:kickoff,updated_time:'2026-11-20T00:00:00Z',rules_primary:'90 minutes plus stoppage time.'}));
const cfg=await loadPaperConfig();
it('uses the receipt of the fetched book for live quote freshness',async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(at);
  try{
    const rows=await readMarkets(SERIES,async()=>Response.json({markets:payload,cursor:''}));
    const card=evaluateQuotes(rows,[match],at,cfg,'Kalshi live response');
    expect(card.every(m=>m.probability!==null)).toBe(true);
    const old=evaluateQuotes(rows,[match],new Date(+at+2*3600000),cfg,'Kalshi live response');
    expect(old.every(m=>m.reason==='stale_quote')).toBe(true);
  }finally{vi.useRealTimers();}
});
it('links regulation-qualified labels without accepting other settlement scopes',async()=>{
  const rows=(await readMarkets(SERIES,async()=>Response.json({markets:payload,cursor:''}))).map(q=>({...q,updated:at.toISOString(),label:'Reg Time: '+q.label}));
  const matched=evaluateQuotes(rows,[match],at,cfg,'fixture');
  expect(matched.map(r=>r.outcome)).toEqual(['home','draw','away']);
  const wrong=evaluateQuotes(rows.map(q=>({...q,label:q.label.replace('Reg Time:','Extra Time:')})),[match],at,cfg,'fixture');
  expect(wrong.every(r=>r.probability===null)).toBe(true);
});
it('reports successful private holdings and fills with their counts',async()=>{
  const result=await consult({question:'Show my positions',read:async()=>({status:'ok',positions:[{ticker:'ABC',position_fp:'3.00'}],recentFills:[],source:'Kalshi',asOf:at.toISOString()}),audit:async()=>{}},'local');
  expect(result.answer).toMatch(/1\s+(?:open\s+)?position/i);
  expect(result.answer).toMatch(/0\s+(?:recent\s+)?fills|no\s+(?:recent\s+)?fills/i);
});
