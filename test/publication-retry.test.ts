import {it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {database} from '../src/db.js';
import {daily} from '../src/store.js';
import * as engine from '../src/pipeline.js';

it('rolls back an expired live calculation and re-reads prices and the new UTC day’s exposure',async()=>{
  const path=await mkdtemp(join(tmpdir(),'asterisk-rollover-')),db=await database(undefined,path);
  const current=new Date(),previous=new Date(+current-86_400_000),seed=randomUUID();
  try{
    await db.migrate();
    await db.rows("INSERT INTO runs(id,mode,run_day,card) VALUES($1,'live',$2,$3::jsonb)",[seed,current.toISOString().slice(0,10),JSON.stringify({mode:'live'})]);
    await db.rows('INSERT INTO predictions VALUES($1,$2,$3::jsonb)',[seed,'EXISTING',JSON.stringify({stake:3,match:'Existing match',kickoff:new Date(+current+86_400_000).toISOString()})]);
    const real=engine.buildCard;
    const seen:boolean[]=[];
    const fetchQuotes=vi.spyOn(engine,'buildCard').mockImplementation(async(_mode,at,learned,allocations,capture)=>{
      seen.push(Boolean(allocations?.find(a=>a.ticker==='EXISTING')?.today));
      const card=await real('demo',at,learned,allocations,capture);
      return {...card,mode:'live',simulation:false};
    });
    const run=await daily(db,'live',previous,true);
    expect(fetchQuotes).toHaveBeenCalledTimes(2);
    expect(seen).toEqual([false,true]);
    expect(run.card.asOf.slice(0,10)).toBe(current.toISOString().slice(0,10));
    expect(await db.rows('SELECT count(*)::int AS n FROM runs')).toEqual([{n:2}]);
    expect(await db.rows('SELECT run_id FROM run_publications')).toEqual([{run_id:run.id}]);
  }finally{vi.restoreAllMocks();await db.close();await rm(path,{recursive:true,force:true});}
},60000);
