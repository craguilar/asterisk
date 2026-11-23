import { expect, it } from 'vitest';
import { evaluateRules, type RuleFacts, type Target } from '../../src/rules.js';
const base:RuleFacts = {source:'scouting fixture',favorite:'home',home:{},away:{}};
const cases:Array<[string,Partial<RuleFacts>,Target,number]> = [
  ['R01',{home:{bigWinDistorted:true}},'context',0],
  ['R02',{home:{defensiveCollapse:true}},'away',.125],
  ['R03',{home:{mustWin:true},away:{safe:true}},'home',.1],
  ['R04',{home:{transitionLeaky:true},away:{scoresRecently:true}},'btts',.3],
  ['R06',{home:{trophyInDays:4}},'home',-.4],
  ['R07',{home:{rotationHigh:true,mustWin:true}},'context',0],
  ['R08',{home:{eliminated:true,freshReserves:true}},'homeScores',.1],
  ['R09',{home:{drawSufficient:true,organized:true},away:{organized:true}},'draw',.15],
  ['R10',{away:{noScoringMechanism:true}},'awayScores',-.3],
  ['R11',{away:{confirmedStarOut:'A'}},'away',-.35],
  ['R12',{home:{returningStrikerPoorForm:true}},'context',0],
  ['R13',{home:{qualified:true}},'context',0],
  ['R16',{home:{breaksLowBlock:false},away:{organized:true}},'draw',.15],
  ['R21',{knockout:true,away:{openPlay:false}},'context',0],
  ['R25',{home:{weakOppositionStreak:true},away:{eliteAttack:true}},'awayScores',.3],
  ['R26',{home:{deepFreshBench:true},away:{played120:true}},'home',.25],
  ['R27',{home:{surprisingCoach:true}},'context',0],
  ['R28',{home:{transitionLeaky:true}},'btts',.3],
  ['R30',{deadRubber:true,away:{freshReserves:true},home:{tiredStarters:true}},'away',.125],
  ['R31',{highAltitude:true,away:{altitudeAcclimated:false}},'home',.1],
  ['M19',{knockout:true},'context',0],
  ['M20',{knockout:true,home:{frequentDraws:true,lateScorer:false},away:{frequentDraws:true,lateScorer:false}},'extraTime',.2],
  ['M22',{knockout:true,home:{lowEvent:true},away:{lowEvent:true}},'extraTime',.15],
  ['M29',{knockout:true,home:{lateScorer:true}},'extraTime',-.3],
  ['M10',{knockout:true,lateStage:true},'extraTime',.1],
];
it.each(cases)('attributes %s to its supported context and respects its tier', (id, facts, target, expected)=>{
  const fires=evaluateRules({...base,...facts});
  expect(fires.find(f=>f.id===id&&f.target===target)).toMatchObject({source:base.source,applied:expected});
});
it('keeps all observation-only catalog rules at zero',()=>{
  const observations=['R15','R23','R24a','R-v9','R-mkt'];
  const fires=evaluateRules({...base,observations},{R23:1});
  expect(fires.map(f=>f.id).sort()).toEqual([...observations].sort());
  expect(fires.every(f=>f.applied===0)).toBe(true);
});
it('preserves provenance and base features for a zero-weight rule',()=>{
  const fires=evaluateRules({...base,away:{confirmedStarOut:'A'}},{R11:0});
  expect(fires[0]).toMatchObject({id:'R11',feature:-.35,weight:0,applied:-0,source:base.source});
});
