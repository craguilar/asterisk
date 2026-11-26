import {expect,it} from 'vitest';
import {learnWeights,ruleAttribution,type TrainingExample} from '../src/learning.js';
import {combine,normalize} from '../src/math.js';
import {buildCard} from '../src/pipeline.js';
import type {RuleFire} from '../src/rules.js';

const coach:RuleFire={id:'R27',tier:2,target:'context',raw:0,applied:0,feature:0,weight:.75,source:'test',explanation:'Coach uncertainty'};
const positive:RuleFire={id:'R31',tier:2,target:'home',raw:.1,applied:.1,feature:.2,weight:.5,source:'test',explanation:'Altitude'};
const prior=[.65,.20,.15],model=[.15,.35,.50],base=.2,effective=.8;
async function sample(count:number,variant:'current'|'legacy'|'control',withPositive:boolean) {
  const fixture=await buildCard('demo',new Date('2026-11-07T16:00:00Z'));
  const all:TrainingExample[]=[];
  for(let i=0;i<count;i++) {
    const card=structuredClone(fixture);card.mode='live';card.simulation=false;card.marketWeight=variant==='control'?effective:base;
    const outcomes:TrainingExample['outcomes']={};
    const winner=i%5<2?0:i%5===2?1:2;
    const weight=variant==='legacy'?base:effective;
    const probabilities=normalize(prior.map((p,j)=>combine(p,model[j],weight,j===0 && withPositive?(variant==='legacy'?.05:.025):0)));
    for(const [j,row] of card.markets.entries()){
      row.prior=prior[j];row.model=model[j];row.probability=probabilities[j];row.outcome=(['home','draw','away'] as const)[j];
      row.rules=variant==='control'?[]:[coach];
      if(j===0 && withPositive) row.rules.push(variant==='control'?{...positive,feature:.05,applied:.025}:positive);
      row.ruleAdjustment=j===0 && withPositive?(variant==='legacy'?.05:.025):0;
      if(variant==='legacy')delete row.effectiveMarketWeight;
      else row.effectiveMarketWeight=effective;
      row.event+='-'+i;row.ticker+='-'+i;outcomes[row.ticker]={outcome:j===winner?1:0,settledAt:'2026-11-08T04:00:00Z'};
    }
    all.push({card,outcomes});
  }
  return all;
}
const loss=(y:number,p:number)=>-Math.log(y?p:1-p);
it('attributes a pure context R27 by removing its pull toward the market across all three outcomes',async()=>{
  const rows=await sample(1,'current',false);
  const report=ruleAttribution(rows).find(s=>s.id==='R27')!;
  const counterfactual=normalize(prior.map((p,j)=>combine(p,model[j],base,0)));
  const issued=rows[0].card.markets;
  const expected=issued.reduce((s,r,j)=>s+loss(Number(j===0),r.probability!)-loss(Number(j===0),counterfactual[j]),0)/3;
  expect(report.deltaLogLoss).toBeCloseTo(expected,12);
  expect(report.fireCount).toBe(3);
  expect(ruleAttribution(await sample(1,'legacy',false))[0].deltaLogLoss).toBeCloseTo(0,12);
});
it('fits the same coefficients as equivalent rows carrying the issued blend and scaled features explicitly',async()=>{
  const expected=learnWeights(await sample(20,'control',true))!.weights.R31;
  expect(expected).toBeLessThan(0);
  expect(learnWeights(await sample(20,'current',true))!.weights.R31).toBeCloseTo(expected,10);
});


it('restores the other rule’s full adjustment together with the base blend when removing R27',async()=>{
  const reports=await sample(1,'current',true);
  const distribution=normalize(prior.map((p,i)=>combine(p,model[i],base,i===0?.1:0)));
  const expected=reports[0].card.markets.reduce((sum,row,i)=>sum+loss(Number(i===0),row.probability!)-loss(Number(i===0),distribution[i]),0)/3;
  const found=ruleAttribution(reports).find(entry=>entry.id==='R27')!;
  expect(found.deltaLogLoss).toBeCloseTo(expected,12);
});
