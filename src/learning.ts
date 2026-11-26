import { createHash } from 'node:crypto';
import { capRules, combine, normalize } from './math.js';
import { marketDeviationScale, ruleRegistry, type RuleFire } from './rules.js';
import type { EngineCard, CardMarket } from './pipeline.js';

export interface TrainingExample {
  card:EngineCard;
  outcomes:Record<string,{outcome:0|1;settledAt:string}>;
}
export interface WeightVersion {
  version:string; weights:Record<string,number>; trainedThrough:string; sampleCount:number; eligibleTickers:string[];
}
interface Label {
  row:CardMarket; day:string; version:string; y:number; settledAt:string; prior:number; model:number; baseWeight:number; issuedWeight:number; features:Map<string,number>;
}
const registry=new Map(ruleRegistry.map(r=>[r.id,r]));
const logit=(p:number)=>Math.log(p/(1-p));
function labelledGroups(examples:TrainingExample[]) {
  const groups:Label[][]=[], seen=new Set<string>();
  for (const {card,outcomes} of [...examples].sort((a,b)=>a.card.asOf.localeCompare(b.card.asOf))) {
    if (card.mode!=='live' || card.simulation || !Number.isFinite(Date.parse(card.asOf))) continue;
    const grouped=new Map<string,Label[]>();
    for (const row of card.markets) {
      const o=outcomes[row.ticker], weight=row.effectiveMarketWeight??card.marketWeight;
      if (!o || ![0,1].includes(o.outcome) || !(Date.parse(o.settledAt)>Date.parse(card.asOf)) ||
          row.kickoff===null || !(Date.parse(card.asOf)<Date.parse(row.kickoff)) || !row.outcome ||
          row.prior===null || row.model===null || !(row.prior>0 && row.prior<1 && row.model>0 && row.model<1) ||
          !(card.marketWeight>=0 && card.marketWeight<=1 && weight>=0 && weight<=1) || row.probability===null || seen.has(row.ticker)) continue;
      const features=new Map<string,number>();
      for (const rule of row.rules) {
        const entry=registry.get(rule.id);
        if (!entry || entry.tier===3 || rule.target!==row.outcome || !rule.feature || !Number.isFinite(rule.feature)) continue;
        features.set(rule.id,(features.get(rule.id)??0)+Math.max(-entry.cap,Math.min(entry.cap,rule.feature)));
      }
      const label={row,day:card.asOf.slice(0,10),version:card.weightVersion??'unversioned',y:o.outcome,settledAt:o.settledAt,prior:row.prior,model:row.model,baseWeight:card.marketWeight,issuedWeight:weight,features};
      const group=grouped.get(row.event)??[]; group.push(label); grouped.set(row.event,group);
    }
    for (const group of grouped.values()) {
      if (group.length!==3 || new Set(group.map(r=>r.row.ticker)).size!==3 || new Set(group.map(r=>r.row.outcome)).size!==3 ||
          group.reduce((sum,r)=>sum+r.y,0)!==1) continue;
      group.forEach(r=>seen.add(r.row.ticker));
      groups.push(group);
    }
  }
  return groups;
}
function ruleScale(row:CardMarket,fires:RuleFire[]) {
  // Legacy cards damped only rule adjustments, with a fixed factor whenever R27 fired.
  return row.effectiveMarketWeight===undefined ? (fires.some(f=>f.id==='R27') ? .5 : 1) : marketDeviationScale(fires);
}
export function learnWeights(examples:TrainingExample[], previous?:WeightVersion|null):WeightVersion|null {
  const rows=labelledGroups(examples).flat(), before=new Set(previous?.eligibleTickers??[]);
  const added=rows.filter(r=>!before.has(r.row.ticker));
  if (added.length<50) return null;
  // Preserve sample accounting even if the caller supplied an incomplete ledger query.
  if (previous && !previous.eligibleTickers.every(t=>rows.some(r=>r.row.ticker===t))) return null;
  const ids=[...new Set(rows.flatMap(r=>[...r.features.keys()]))].sort();
  if (!ids.length) return null;
  const weights={...previous?.weights};
  for (const id of ids) weights[id]??=registry.get(id)!.weight;
  // Fixed market/model logit is an offset. Fit only catalog coefficients, using
  // proximal gradient descent for the mean binomial deviance plus L1 penalty.
  const data=rows.map(r=>({offset:r.issuedWeight*logit(r.prior)+(1-r.issuedWeight)*logit(r.model),
    terms:[...r.features].map(([id,value])=>({id,x:value*ruleScale(r.row,r.row.rules)})),y:r.y}));
  const maxNorm=Math.max(1,...data.map(r=>r.terms.reduce((s,t)=>s+t.x*t.x,0)));
  const step=3/maxNorm, penalty=.002;
  for (let n=0;n<400;n++) {
    const gradient:Record<string,number>=Object.fromEntries(ids.map(id=>[id,0]));
    for (const r of data) {
      const eta=r.terms.reduce((sum,{id,x})=>sum+weights[id]!*x,r.offset);
      const residual=1/(1+Math.exp(-eta))-r.y;
      for (const {id,x} of r.terms) gradient[id]=gradient[id]!+residual*x/data.length;
    }
    let maxChange=0;
    for (const id of ids) {
      const prior=weights[id]!, unconstrained=prior-step*gradient[id]!;
      // Catalog caps apply at inference; keep coefficients within unit magnitude to match that domain.
      weights[id]=Math.max(-1,Math.min(1,Math.sign(unconstrained)*Math.max(0,Math.abs(unconstrained)-step*penalty)));
      maxChange=Math.max(maxChange,Math.abs(weights[id]!-prior));
    }
    if (maxChange<1e-7) break;
  }
  const trainedThrough=new Date(Math.max(...rows.map(r=>Date.parse(r.settledAt)))).toISOString();
  const eligibleTickers=rows.map(r=>r.row.ticker).sort();
  const version='l1-'+createHash('sha256').update(JSON.stringify([weights,trainedThrough,eligibleTickers])).digest('hex').slice(0,16);
  return {version,weights,trainedThrough,eligibleTickers,sampleCount:rows.length};
}
function withoutRule(group:Label[],omit:string) {
  // Removing a fire changes the unnormalised probability on the affected side.
  // Apply that ratio to the distribution actually published, then renormalize
  // the three outcomes. Every coefficient and adjustment came from this run.
  return normalize(group.map(({row,prior,model,baseWeight,issuedWeight})=>{
    const remaining=row.rules.filter(rule=>rule.id!==omit);
    const targetAdjustments=remaining.filter(rule=>rule.target===row.outcome).map(rule=>rule.applied);
    const reducedScale=ruleScale(row,remaining);
    const reduced=capRules(targetAdjustments)*reducedScale;
    const counterfactualWeight=row.effectiveMarketWeight===undefined ? baseWeight : 1-(1-baseWeight)*reducedScale;
    const originalTotal=Number.isFinite(row.ruleAdjustment)?row.ruleAdjustment:
      capRules(row.rules.filter(rule=>rule.target===row.outcome).map(rule=>rule.applied))*ruleScale(row,row.rules);
    const before=combine(prior,model,issuedWeight,originalTotal);
    const after=combine(prior,model,counterfactualWeight,reduced);
    return row.probability!*after/before;
  }));
}
export function ruleAttribution(examples:TrainingExample[],range:{from?:string;to?:string}={}) {
  const stats=new Map<string,{count:number;sumAdjustment:number;sumLossDelta:number;versions:Set<string>}>();
  for(const group of labelledGroups(examples)){
    const day=group[0]!.day;
    if((range.from && day<range.from)||(range.to && day>range.to)) continue;
    const ids=new Set(group.flatMap(({row})=>row.rules.filter(f=>f.target===row.outcome||f.id==='R27').map(f=>f.id)));
    for(const id of ids){
      const without=withoutRule(group,id);
      const s=stats.get(id)??{count:0,sumAdjustment:0,sumLossDelta:0,versions:new Set<string>()};
      for(const [i,{row,y,version}] of group.entries()){
        const fires=row.rules.filter(r=>r.id===id&&(r.target===row.outcome||id==='R27'));
        if(!fires.length)continue;
        const loss=(p:number)=>-Math.log(Math.max(1e-15,y?p:1-p));
        s.sumLossDelta+=loss(row.probability!)-loss(without[i]!);
        s.sumAdjustment+=fires.reduce((v,r)=>v+r.applied,0);
        s.versions.add(version);
        s.count++;
      }
      stats.set(id,s);
    }
  }
  return [...stats].sort(([a],[b])=>a.localeCompare(b)).map(([id,s])=>({id,fireCount:s.count,
    meanApplied:s.sumAdjustment/s.count,deltaLogLoss:s.sumLossDelta/s.count,harmful:s.sumLossDelta>0,
    weightVersions:[...s.versions].sort()}));
}
