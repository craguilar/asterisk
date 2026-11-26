import {it,expect} from 'vitest';
import {evaluateRules,marketDeviationScale,knockoutRoute,secondaryEstimates,ruleRegistry,type RuleFacts} from '../src/rules.js';
import {scoreGrid} from '../src/math.js';
const base:RuleFacts={home:{},away:{},favorite:'home',source:'scout'};
const finite=scoreGrid(1.5,1,0);
it.each(ruleRegistry.filter(r=>r.tier<3))('leaves $id inactive without its required evidence',r=>{
  expect(evaluateRules(base).some(f=>f.id===r.id)).toBe(false);
});
it('blocks a claimed star-return route only when the returning player has supporting negative evidence',()=>{
  const t:RuleFacts={...base,away:{noScoringMechanism:true,returningStarScoringRoute:true}};
  expect(evaluateRules(t).some(f=>f.id==='R10')).toBe(false);
  const guarded=evaluateRules({...t,away:{...t.away,returningStrikerPoorForm:true}});
  expect(guarded.map(f=>f.id)).toEqual(['R10','R12']);
  expect(guarded[0].applied).toBe(-.3);
});
it('damps the model’s departure from market when coach uncertainty is active, respecting a disabled rule',()=>{
  const facts={...base,home:{surprisingCoach:true}};
  expect(marketDeviationScale(evaluateRules(facts))).toBe(.5);
  expect(marketDeviationScale(evaluateRules(facts,{R27:0}))).toBe(1);
});
it('partitions a separately supplied advancement probability conservatively only for a closed matchup',()=>{
  const r=knockoutRoute(.4,.3,.25,false,true)!;
  expect(r.regulationWin+r.extraTimeOrPenaltyWin).toBeCloseTo(.4,12);
  expect(r.extraTimeOrPenaltyWin).toBeCloseTo(.175,12);
  expect(knockoutRoute(.4,.3,.25,true,true)?.shift).toBe(0);
  expect(knockoutRoute(.4,.3,.25,undefined,undefined)?.shift).toBe(0);
  expect(knockoutRoute(.2,.3,.25,false,true)).toBeNull();
});
it('reports a conditional level-at-90 stoppage calculation only when minutes were observed',()=>{
  const facts={...base,knockout:true};
  expect(secondaryEstimates(finite,[],facts).levelAfterStoppage).toBeNull();
  expect(secondaryEstimates(finite,[],{...facts,expectedAddedMinutes:0}).levelAfterStoppage).toBe(1);
  const p=secondaryEstimates(finite,[],{...facts,expectedAddedMinutes:6}).levelAfterStoppage!;
  expect(p).toBeLessThan(1);expect(p).toBeGreaterThan(0);
});
