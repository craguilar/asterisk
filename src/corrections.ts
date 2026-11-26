import {z} from 'zod';
import type {Database,Sql} from './db.js';
import type {Mode} from './store.js';

const correction=z.object({
  runId:z.uuid(),ticker:z.string().min(1).max(128),expectedRevision:z.number().int().nonnegative(),
  correctedProbability:z.number().min(0).max(1),reason:z.string().trim().min(4).max(600),
  source:z.url().max(1500).refine(value=>{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;})
}).strict();

export async function recordCorrection(db:Database,input:unknown){
  const c=correction.parse(input);
  return db.transaction(async tx=>{
    const [target]=await tx.rows('SELECT observation FROM predictions WHERE run_id=$1 AND ticker=$2 FOR UPDATE',[c.runId,c.ticker]);
    if(!target)throw Error('Original prediction not found');
    if(typeof target.observation.probability!=='number') throw Error('Original forecast has no published probability');
    const [last]=await tx.rows('SELECT * FROM forecast_corrections WHERE run_id=$1 AND ticker=$2 ORDER BY revision DESC LIMIT 1',[c.runId,c.ticker]);
    if(last?.revision===c.expectedRevision+1 && last.reason===c.reason && last.source===c.source && last.corrected_probability===c.correctedProbability)return last;
    if((last?.revision??0)!==c.expectedRevision)throw Error('Correction conflicts with a later revision');
    const [added]=await tx.rows(`INSERT INTO forecast_corrections(run_id,ticker,revision,corrected_probability,reason,source)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[c.runId,c.ticker,c.expectedRevision+1,c.correctedProbability,c.reason,c.source]);
    return added;
  });
}
export async function correctionHistory(sql:Sql,mode:Mode,runId:string){
  const rows=await sql.rows(`SELECT c.ticker,c.revision,c.corrected_probability AS "correctedProbability",c.reason,c.source,c.recorded_at AS "recordedAt",
     (p.observation->>'probability')::float8 AS "originalProbability"
     FROM forecast_corrections c JOIN predictions p USING(run_id,ticker) JOIN runs r ON r.id=c.run_id
     WHERE r.mode=$1 AND r.id=$2 ORDER BY c.ticker,c.revision`,[mode,runId]);
  return {runId,mode,corrections:rows};
}
