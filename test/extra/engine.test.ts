import { describe, it, expect } from 'vitest';
import { readMarkets, SERIES, type Quote } from '../../src/kalshi.js';
import { evaluateQuotes, loadPaperConfig, type Match } from '../../src/pipeline.js';
import { adjustment, decidedInRegulation, evaluateRules, type RuleFacts } from '../../src/rules.js';
import { scoreGrid, lateWindow, normalize } from '../../src/math.js';

const at=new Date('2026-11-07T16:00:00Z'), kickoff='2026-11-07T23:00:00Z';
const match:Match={home:'Toluca',away:'Monterrey',aliasesHome:['TOL'],aliasesAway:['MON'],kickoff,lambdaHome:1.6,lambdaAway:1,rho:0};
const event=SERIES+'-26NOV07TOLMON';
function quotes():Quote[] {
  return ['TOL','Tie','MON'].map((label,i)=>({ticker:event+'-'+label,event,title:label,label,open:'2026-11-01T00:00:00Z',
    close:kickoff,status:'active',rules:'90 minutes plus stoppage time',updated:at.toISOString(),last:.3,volume:1000,askSize:500,
    ask:[.25,.33,.44][i]!,bid:[.24,.32,.43][i]!}));
}
const cfg=await loadPaperConfig();
const evaluate=(q=quotes(),m=[match])=>evaluateQuotes(q,m,at,cfg,'fixture');
describe('paper card',()=>{
  it('normalizes a complete group, stores the components and fits within currency and depth caps',()=>{
    const rows=evaluate();
    expect(rows.map(c=>c.probability!).reduce((a,b)=>a+b,0)).toBeCloseTo(1,10);
    expect(rows[0]).toMatchObject({decision:'paper_pick',outcome:'home',fee:.02});
    expect(rows[0]!.stake).toBeGreaterThan(0);
    expect(rows[0]!.stake).toBeLessThanOrEqual(cfg.perBetCap);
    expect(rows[0]!.stake).toBeCloseTo(rows[0]!.contracts*.27);
    const q=quotes(); q[0]!.askSize=1;
    expect(evaluate(q)[0]!.contracts).toBe(1);
  });
  it.each([
    ['stale_quote',{updated:'2026-11-06T00:00:00Z'}],['stale_quote',{updated:'2026-11-07T16:01:00Z'}],
    ['market_closed',{status:'finalized'}],['market_closed',{close:at.toISOString()}],
    ['invalid_quote',{ask:null}],['invalid_quote',{ask:0}],['invalid_quote',{ask:1}],
    ['unsupported_settlement',{rules:'Team advances after penalties.'}],
  ] as const)('withholds the whole mutually exclusive group on %s', (reason,change)=>{
    const q=quotes(); Object.assign(q[0]!,change);
    const rows=evaluate(q); expect(rows.every(c=>c.reason===reason && c.probability===null && c.stake===0)).toBe(true);
  });
  it('requires an unambiguous fixture, a future kickoff and a complete mapping',()=>{
    expect(evaluate(quotes(),[match,match]).every(c=>c.reason==='unlinked')).toBe(true);
    expect(evaluate(quotes(),[{...match,kickoff:'2026-11-07T15:00:00Z'}]).every(c=>c.reason==='match_started')).toBe(true);
    expect(evaluate(quotes().filter(q=>q.label!=='Tie')).every(c=>c.reason==='incomplete_outcomes')).toBe(true);
  });
  it('uses market-only probabilities when football is missing and never sizes an unknown book',()=>{
    const missing=evaluate(quotes(),[{...match,lambdaAway:null}]);
    expect(missing[0]!.probability).toBeCloseTo(missing[0]!.prior!);
    expect(missing.every(c=>c.reason==='model_missing' && c.stake===0)).toBe(true);
    const q=quotes(); q[0]!.askSize=null;
    expect(evaluate(q)[0]).toMatchObject({reason:'depth_unavailable',decision:'no_bet',stake:0});
  });
});
describe('catalog evidence',()=>{
  const base:RuleFacts={home:{},away:{},source:'test evidence',favorite:'home'};
  it('ignores doubtful stars and attaches source to confirmed flags',()=>{
    expect(evaluateRules({...base,home:{doubtfulStar:'Player A'}})).toHaveLength(0);
    const f=evaluateRules({...base,home:{confirmedStarOut:'Player A'}});
    expect(f[0]).toMatchObject({id:'R11',target:'home',applied:-.35,source:base.source});
  });
  it('checks must-win evidence before rotation discounts',()=>{
    const f=evaluateRules({...base,home:{rotationHigh:true,mustWin:true}});
    expect(f.some(r=>r.id==='R07')).toBe(true); expect(f.some(r=>r.id==='R06')).toBe(false);
  });
  it('applies rotation, tier weights, shrinkage and the log-only constraint',()=>{
    const f=evaluateRules({...base,home:{rotationHigh:true,surprisingCoach:true},away:{altitudeAcclimated:false},highAltitude:true,observations:['R23']});
    expect(adjustment(f,'home')).toBeCloseTo((-.4+.1)*.5); expect(f.find(r=>r.id==='R23')!.applied).toBe(0);
  });
  it('raises extra time for two low-event teams and drops it when the late scorer appears',()=>{
    const facts={...base,knockout:true,home:{lowEvent:true},away:{lowEvent:true}};
    const base90=decidedInRegulation(evaluateRules(facts));
    expect(base90).toBeLessThan(.77);
    expect(decidedInRegulation(evaluateRules({...facts,home:{...facts.home,lateScorer:true}}))).toBeGreaterThan(base90);
  });
  it('extends the goal grid until its tail is negligible and conditions on time remaining',()=>{
    const g=scoreGrid(4.5,2,.01);
    expect(g.cells.length).toBeGreaterThan(10); expect(g.home+g.draw+g.away).toBeCloseTo(1,10);
    expect(lateWindow(1.6,1,19)).toBeGreaterThan(scoreGrid(1.6,1).draw);
    expect(()=>normalize([0,0,0])).toThrow();
  });
});
describe('Kalshi boundary',()=>{
  it('blocks path and query input before calling transport',async()=>{
    let calls=0; await expect(readMarkets('/portfolio/orders',async()=>{calls++;return Response.json({});})).rejects.toThrow();
    expect(calls).toBe(0);
  });
  it('rejects a repeated cursor instead of marking a partial page complete',async()=>{
    let calls=0;
    await expect(readMarkets(SERIES,async()=>{calls++;return Response.json({markets:[],cursor:'same'});})).rejects.toThrow('Repeated');
    expect(calls).toBe(2);
  });
});
