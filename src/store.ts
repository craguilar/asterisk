import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {persistDomain,type DomainInputs} from './domain.js';
import {latestWeights} from './weights.js';
import {enrichNews} from './news.js';
import {buildCard,loadPaperConfig,type Allocation} from './pipeline.js';
import type {Database, Sql} from './db.js';

export type Mode='live'|'replay'|'demo';
type Card=Awaited<ReturnType<typeof buildCard>>;
export interface Run {id:string; card:Card; attempted_at:Date|string}
export class Problem extends Error {constructor(readonly statusCode:number,message:string){super(message);}}
export const replayTime='2026-11-07T16:00:00.000Z';
const day=(d:Date)=>d.toISOString().slice(0,10);

class ForecastBoundaryPassed extends Error {}
export async function daily(db:Database,mode:Mode,at=new Date(),force=false):Promise<Run>{
  try{return await captureRun(db,mode,at,force);}
  catch(error){
    if(!(error instanceof ForecastBoundaryPassed))throw error;
    // The first transaction rolled back its allocations. Re-read the current day's exposure and quotes.
    return captureRun(db,mode,new Date(),true);
  }
}
async function captureRun(db:Database,mode:Mode,at:Date,force:boolean):Promise<Run>{
  const when=mode==='replay'?new Date(replayTime):at;
  return db.transaction(async tx=>{
    await tx.rows('SELECT pg_advisory_xact_lock(hashtext($1))',['daily:'+mode]);
    const [cached]=await tx.rows<Run>('SELECT r.* FROM runs r JOIN domain_runs d ON d.run_id=r.id WHERE r.mode=$1 AND r.run_day=$2 ORDER BY r.attempted_at DESC LIMIT 1',[mode,day(when)]);
    if(cached && mode!=='live' && cached.card.status!=='unavailable') return cached;
    const ttl=(await loadPaperConfig()).maxQuoteAgeMinutes*60_000;
    if(cached && mode==='live' && !force && cached.card.status==='ready' && when.valueOf()-Date.parse(cached.card.asOf)<ttl) return cached;
    // Empty and partial feeds may recover before the next cron. Deduplicate overlapping requests.
    if(cached && mode==='live' && !force && cached.card.status!=='unavailable' && when.valueOf()-Date.parse(cached.card.asOf)<60_000) return cached;
    const previous=mode==='live'?await tx.rows<Allocation>(`SELECT p.ticker,p.observation->>'match' AS match,p.observation->>'kickoff' AS kickoff,
      (p.observation->>'stake')::float8 AS stake,(r.run_day=$1::date) AS today FROM predictions p JOIN runs r ON r.id=p.run_id
      WHERE r.mode='live' AND (p.observation->>'stake')::float8>0 AND
      (r.run_day=$1::date OR (p.observation->>'kickoff')::timestamptz>=$2::timestamptz)`,[day(when),when.toISOString()]):[];
    let inputs:DomainInputs|undefined;
    const card=await enrichNews(await buildCard(mode,when,mode==='live'?(await latestWeights(tx)??undefined):undefined,previous,data=>{inputs=data;}));
    if(!inputs)throw Error('Pipeline did not capture its domain inputs');
    const [run]=await tx.rows<Run>('INSERT INTO runs(id,mode,run_day,card) VALUES($1,$2,$3,$4::jsonb) RETURNING *',[randomUUID(),mode,day(when),JSON.stringify(card)]);
    for (const m of card.markets) await tx.rows('INSERT INTO predictions VALUES($1,$2,$3::jsonb)',[run.id,m.ticker,JSON.stringify(m)]);
    await persistDomain(tx,run.id,card,inputs);
    if(mode==='replay'){
      type Final={ticker:string;outcome:number;closingAsk:number|null;settledAt:string;source:string};
      const finals:Final[]=JSON.parse(await readFile(new URL('../data/replay-settlements.json',import.meta.url),'utf8'));
      const total=finals.every(m=>m.closingAsk!==null)?finals.reduce((sum,m)=>sum+Number(m.closingAsk),0):0;
      for(const f of finals) if(card.markets.some(m=>m.ticker===f.ticker)) await tx.rows(
        'INSERT INTO settlements VALUES($1,$2,$3,$4,$5,$6)',[run.id,f.ticker,f.outcome,total?Number(f.closingAsk)/total:null,f.source,f.settledAt]);
    }
    const [publication]=await tx.rows('INSERT INTO run_publications(run_id) VALUES($1) RETURNING recorded_at',[run.id]);
    if(mode==='live' && card.markets.some(m=>m.probability!==null)){
      const issued=new Date(publication.recorded_at);
      if(day(issued)!==day(when) || card.asOf.slice(0,10)!==day(when) ||
         card.markets.some(m=>m.probability!==null && m.kickoff && Date.parse(m.kickoff)<=issued.valueOf())){
        throw new ForecastBoundaryPassed('Live allocation crossed its day or kickoff before publication');
      }
    }
    return run;
  });
}
export async function latest(sql:Sql, mode:Mode){
  const [run]=await sql.rows<Run>('SELECT * FROM runs WHERE mode=$1 ORDER BY run_day DESC, attempted_at DESC LIMIT 1',[mode]);
  return run;
}
export {performance} from './performance.js';
export async function reserveConsult(db:Database,principal:string,mode:Mode,id?:string,expectedRevision?:number) {
  return db.transaction(async tx=>{
    await tx.rows("DELETE FROM sessions WHERE principal=$1 AND expires_at<now()",[principal]);
    const sid=id??randomUUID();
    if(!id) await tx.rows('INSERT INTO sessions(id,principal,mode) VALUES($1,$2,$3)',[sid,principal,mode]);
    const [session]=await tx.rows('SELECT * FROM sessions WHERE id=$1 AND principal=$2 AND mode=$3 AND expires_at>now() FOR UPDATE',[sid,principal,mode]);
    if(!session) throw new Problem(404,'Session unavailable');
    if(id && session.revision!==expectedRevision)throw new Problem(409,'Session changed. Reload the session to continue.');
    const q=await tx.rows("INSERT INTO quota VALUES($1,(now() AT TIME ZONE 'UTC')::date,1) ON CONFLICT(principal,day) DO UPDATE SET runs=quota.runs+1 WHERE quota.runs<100 RETURNING runs",[principal]);
    if(!q.length)throw new Problem(429,'Daily consultation quota reached');
    return {id:sid,revision:Number(session.revision),previousTool:session.previous_tool as string|undefined};
  });
}
export async function finishConsult(db:Database,principal:string,id:string,revision:number,tool:string,answer:string,runId:string|null) {
  await db.transaction(async tx=>{
    const changed=await tx.rows('UPDATE sessions SET revision=revision+1,previous_tool=$1 WHERE id=$2 AND principal=$3 AND revision=$4 RETURNING id',[tool,id,principal,revision]);
    if(!changed.length) throw new Problem(409,'Session changed. Reload the session to continue.');
    await tx.rows('INSERT INTO turns(session_id,revision,tool,answer,run_id) VALUES($1,$2,$3,$4,$5)',[id,revision+1,tool,answer,runId]);
  });
}
