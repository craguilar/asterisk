import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {database} from '../src/db.js';
import {daily} from '../src/store.js';
import {recordCorrection} from '../src/corrections.js';
it('preserves the original forecast and prevents two concurrent successors to the same revision',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'asterisk-correction-'));
  const db=await database(undefined,dir);
  try{
    await db.migrate();const run=await daily(db,'replay'),row=run.card.markets[0];
    const initial={runId:run.id,ticker:row.ticker,reason:'Reconciled recorded forecast',source:'https://example.org/audit/1',expectedRevision:0,correctedProbability:.51};
    const outcomes=await Promise.allSettled([recordCorrection(db,initial),recordCorrection(db,{...initial,correctedProbability:.49,reason:'Competing reconciliation'})]);
    expect(outcomes.filter(s=>s.status==='fulfilled')).toHaveLength(1);
    expect(outcomes.filter(s=>s.status==='rejected')).toHaveLength(1);
    await recordCorrection(db,{...initial,expectedRevision:1,correctedProbability:.50,reason:'Supersedes first reconciliation'});
    const [persisted]=await db.rows('SELECT observation FROM predictions WHERE run_id=$1 AND ticker=$2',[run.id,row.ticker]);
    expect(persisted.observation.probability).toBe(row.probability);
  }finally{await db.close();await rm(dir,{recursive:true,force:true});}
},40000);
