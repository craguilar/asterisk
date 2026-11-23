import { describe,it,expect } from 'vitest';
import { learnWeights, ruleAttribution, type TrainingExample } from '../../src/learning.js';
import { buildCard } from '../../src/pipeline.js';

async function samples(n:number) {
  const at=new Date('2026-11-07T16:00:00.000Z');
  const fixture=await buildCard('demo',at);
  // Synthesized settled records exercise the live-only branch without network access.
  const result:TrainingExample[]=[];
  for (let i=0;i<n;i++) {
    const card=structuredClone(fixture); card.mode='live'; card.simulation=false;
    const labels:TrainingExample['outcomes']={};
    for (const row of card.markets) {
      row.ticker+='-'+i;row.event+='-'+i;
      row.model=row.prior??.3; row.probability=row.prior??.3;
      labels[row.ticker]={outcome:row.outcome==='away'?1:0,settledAt:'2026-11-08T04:00:00Z'};
    }
    result.push({card,outcomes:labels});
  }
  return result;
}
describe('ledger-fitted rule weights',()=>{
  it('waits for fifty new outcomes, excludes duplicate samples, and measures harmful signed loss',async()=>{
    const all=await samples(18);
    expect(learnWeights(all.slice(0,16))).toBe(null);
    const fit=learnWeights([...all,...all])!;
    expect(fit.sampleCount).toBe(54);
    expect(fit.weights.R31).toBeLessThan(.5);
    expect(learnWeights(all,fit)).toBe(null);
    const attribution=ruleAttribution(all);
    expect(attribution.find(r=>r.id==='R31')).toMatchObject({harmful:true,fireCount:18});
  });
  it('excludes simulated examples and labels that predate the forecast',async()=>{
    const all=await samples(20);
    for (let i=0;i<all.length;i++) {
      if (i%2===0) all[i]!.card.mode='demo';
      else for (const r of Object.values(all[i]!.outcomes)) r.settledAt='2020-01-01T00:00:00Z';
    }
    expect(learnWeights(all)).toBe(null);
    expect(ruleAttribution(all)).toEqual([]);
  });
});
