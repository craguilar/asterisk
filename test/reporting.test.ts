import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import type {Sql,Row} from '../src/db.js';
import { describe, expect, it } from 'vitest';
import { consult } from '../src/agent.js';
import { performance, summarizeSettled, type SettledForecast } from '../src/performance.js';
import { ruleAttribution, type TrainingExample } from '../src/learning.js';
import { combine, normalize } from '../src/math.js';

describe('performance ledger',()=>{
  it.each([['Explain the probabilities','explain_prediction'],['How did the model perform?','get_performance'],['Show run status','get_run_status']])('routes dashboard question %s',async(question,tool)=>{
    expect((await consult({question,read:async()=>({}),audit:async()=>{}},'local')).tool).toBe(tool);
  });
  const row=(day:string,ticker:string,p:number,contracts:number,stake:number,outcome:number,close:number|null):SettledForecast=>({
    day,as_of:day+'T12:00:00Z',run_id:day,ticker,m:{prior:p,model:p,probability:p,ask:.5,decision:contracts?'paper_pick':'no_bet',contracts,stake,kickoff:'2026-06-05T17:00:00Z'},
    outcome,close_prior:close,source:'official sample',settled_at:'2026-06-05T20:00:00Z',
  });
  it('scores first qualified forecasts once but settles every allocated position including missing closes',()=>{
    const rows=[row('2026-06-01','T',.4,0,0,1,.56),row('2026-06-02','T',.8,2,1.04,1,.56),
      row('2026-06-03','T',.9,4,2.08,1,.56),row('2026-06-03','U',.3,1,.52,0,null)];
    const r=summarizeSettled(rows,'live');
    expect(r.combined?.brier).toBeCloseTo((.36+.09)/2);
    expect(r.settledPaperPicks).toBe(2);
    expect(r.realizedPositions).toHaveLength(3);
    expect(r.realizedPnl).toBeCloseTo(.96+1.92-.52);
    expect(r.uniquePicksWithClv).toBe(1);
    const last=summarizeSettled(rows,'live','2026-06-03','2026-06-03');
    expect(last.settledContracts).toBe(1);
    expect(last.combined?.brier).toBeCloseTo(.09);
    expect(last.realizedPnl).toBeCloseTo(1.92-.52);
  });
  it('attributes recorded forecast weights independently of subsequent learning',()=>{
    const marketWeight=.7;
    const markets=['home','draw','away'].map((outcome,i)=>({ticker:'T'+i,event:'E',outcome,kickoff:'2026-06-02T12:00Z',
      prior:1/3,model:1/3,probability:0,rules:i===0?[{id:'R31',tier:2,target:'home',feature:.2,applied:.18,raw:.18,weight:.9}]:[]}));
    const published=normalize(markets.map(m=>combine(m.prior,m.model,marketWeight,m.rules[0]?.applied??0)));
    markets.forEach((m,i)=>{m.probability=published[i]});
    const card={asOf:'2026-06-01T12:00Z',mode:'live',simulation:false,weightVersion:'historical-v1',marketWeight,markets};
    const input={card,outcomes:Object.fromEntries(markets.map((m,i)=>[m.ticker,{outcome:i===0?1:0,settledAt:'2026-06-02T22:00Z'}]))} as unknown as TrainingExample;
    const r=ruleAttribution([input]);
    expect(r[0].weightVersions).toEqual(['historical-v1']);
    expect(r[0].deltaLogLoss).toBeCloseTo(-Math.log(published[0])+Math.log(1/3),10);
    expect(ruleAttribution([input],{from:'2026-06-02'})).toEqual([]);
  });
});

it('uses a recorded settlement for each snapshot of the same contract and applies the prediction date window',async()=>{
  const db=new PGlite();
  try {
    for(const migration of ['001.sql','004-closing.sql']) await db.exec(await readFile(new URL('../migrations/'+migration,import.meta.url),'utf8'));
    const sql:Sql={rows:async<T extends Row>(query:string,params:unknown[]=[]) => (await db.query<T>(query,params)).rows};
    const early=randomUUID(),later=randomUUID();
    for(const [id,day,p,stake] of [[early,'2026-05-01',.4,0],[later,'2026-05-02',.7,1]] as const){
      const card={mode:'live',simulation:false,asOf:day+'T14:00:00Z',marketWeight:.7,markets:[]};
      const market={prior:p,model:p,probability:p,kickoff:'2026-05-04T15:00:00Z',decision:stake?'paper_pick':'no_bet',ask:.5,contracts:stake?2:0,stake};
      await sql.rows('INSERT INTO runs(id,mode,run_day,card) VALUES($1,$2,$3,$4)',[id,'live',day,JSON.stringify(card)]);
      await sql.rows('INSERT INTO predictions VALUES($1,$2,$3)',[id,'T',JSON.stringify(market)]);
    }
    await sql.rows('INSERT INTO settlements VALUES($1,$2,$3,$4,$5,$6)',[later,'T',1,.55,'test outcome','2026-05-04T17:00:00Z']);
    const all=await performance(sql,'live');
    expect(all.combined?.brier).toBeCloseTo(.36);
    const second=await performance(sql,'live','2026-05-02','2026-05-02');
    expect(second.settledContracts).toBe(0);
    expect(second.realizedPnl).toBe(1);
    expect(second.realizedPositions[0].runId).toBe(later);
  } finally {await db.close();}
},30000);
