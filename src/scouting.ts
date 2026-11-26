import {open} from 'node:fs/promises';
import {z} from 'zod';
import type {Result} from './football.js';
import type {RuleFacts,TeamFacts} from './rules.js';

const name=z.string().trim().min(1).max(100), instant=z.string().datetime({offset:true});
const citation={observedAt:instant,quote:z.string().trim().min(3).max(360),source:z.string().url().refine(v=>{
  const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&!u.search;
})};
const boolean=z.boolean().optional();
const teamFacts=z.object({
  defensiveCollapse:boolean,mustWin:boolean,safe:boolean,scoresRecently:boolean,transitionLeaky:boolean,
  rotationHigh:boolean,trophyInDays:z.number().min(0).max(30).optional(),
  qualified:boolean,eliminated:boolean,freshReserves:boolean,drawSufficient:boolean,organized:boolean,
  noScoringMechanism:boolean,returningStarScoringRoute:boolean,returningStrikerPoorForm:boolean,weakOppositionStreak:boolean,eliteAttack:boolean,
  deepFreshBench:boolean,played120:boolean,surprisingCoach:boolean,tiredStarters:boolean,
  altitudeAcclimated:boolean,frequentDraws:boolean,lateScorer:boolean,lowEvent:boolean,breaksLowBlock:boolean,openPlay:boolean
}).strict();
const matchFacts=z.object({highAltitude:boolean,deadRubber:boolean,knockout:boolean,lateStage:boolean,
  underdogAdvances:z.number().min(0).max(1).optional(),expectedAddedMinutes:z.number().int().min(0).max(20).optional()}).strict();
const base={...citation,home:name,away:name,kickoff:instant};
const entry=z.discriminatedUnion('team',[
  z.object({...base,team:z.literal('home'),facts:teamFacts}).strict(),
  z.object({...base,team:z.literal('away'),facts:teamFacts}).strict(),
  z.object({...base,team:z.literal('match'),facts:matchFacts}).strict()
]);
const corpus=z.object({version:z.literal(1),matchEvidence:z.array(entry).max(500).default([]),
  distortedResults:z.array(z.object({...citation,date:z.string().date(),home:name,away:name,winner:z.enum(['home','away']),
    reason:z.enum(['opponent_red_card','opponent_eliminated','opponent_rotated'])}).strict()).max(500).default([])}).strict();
type Scouting=z.infer<typeof corpus>;
export function parseScouting(raw:unknown,asOf:string):Scouting {
  const data=corpus.parse(raw),cutoff=Date.parse(instant.parse(asOf));
  return {...data,matchEvidence:data.matchEvidence.filter(e=>Date.parse(e.observedAt)<=cutoff && cutoff-Date.parse(e.observedAt)<=7*86400_000 &&
    Date.parse(e.observedAt)<Date.parse(e.kickoff)),distortedResults:data.distortedResults.filter(r=>Date.parse(r.observedAt)<=cutoff)};
}
export async function readScouting(asOf:string) {
  const path=process.env.ASTERISK_SCOUTING_FILE;
  if(!path)return parseScouting({version:1},asOf);
  const file=await open(path,'r');
  try {if((await file.stat()).size>1_000_000)throw Error('Scouting file exceeds size limit');
    return parseScouting(JSON.parse(await file.readFile('utf8')),asOf);
  } finally {await file.close();}
}
export function applyScouting(results:Result[],data:Scouting):Result[] {
  const byMatch=new Map(data.distortedResults.map(r=>[JSON.stringify([r.date,r.home,r.away]),r]));
  return results.map(r=>{
    const evidence=byMatch.get(JSON.stringify([r.date,r.home,r.away]));
    // A source published before the observed final score cannot establish a distorted win.
    if(!evidence||Date.parse(evidence.observedAt)<Date.parse(r.date+'T00:00:00Z') ||
      (evidence.winner==='home'?r.hg-r.ag:r.ag-r.hg)<3)return r;
    return {...r,distortedWin:evidence.winner,distortionEvidence:evidence};
  });
}
export function matchScouting(data:Scouting,fixture:{home:string;away:string;kickoff:string}) {
  const matching=data.matchEvidence.filter(e=>e.home===fixture.home&&e.away===fixture.away&&Date.parse(e.kickoff)===Date.parse(fixture.kickoff))
    .sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt));
  if(!matching.length)return null;
  const facts:RuleFacts={home:{},away:{},source:[...new Set(matching.map(e=>e.source))].join(' · '),favorite:'home'};
  for(const e of matching) {
    if(e.team==='match')Object.assign(facts,e.facts);
    else Object.assign(facts[e.team],e.facts satisfies TeamFacts);
  }
  return facts;
}
export function citedMatchEvidence(data:Scouting,fixture:{home:string;away:string;kickoff:string}){
  return data.matchEvidence.filter(e=>e.home===fixture.home&&e.away===fixture.away&&Date.parse(e.kickoff)===Date.parse(fixture.kickoff));
}
