import {afterAll,beforeAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {database,type Database} from '../src/db.js';
import {settlePending} from '../src/settlement-job.js';
import type {FinalReading} from '../src/settle.js';

let db:Database,dir:string;
const kickoff='2026-01-02T00:00:00Z',day='2026-01-01',run=randomUUID();
const names=['KXLIGAMXGAME-26JAN01AAAAAA','KXLIGAMXGAME-26JAN01BBBBBB','KXLIGAMXGAME-26JAN01CCCCCC','KXLIGAMXGAME-26JAN01DDDDDD'];
const tickers=(event:string)=>['AAA','BBB','TIE'].map(s=>event+'-'+s);
const finals=(event:string):FinalReading[]=>tickers(event).map((ticker,i)=>({ticker,outcome:i===0?1:0,
  closingPrior:[.5,.3,.2][i]!,settledAt:'2026-01-02T02:00:00Z',source:'official fixture'}));
beforeAll(async()=>{
  dir=await mkdtemp(join(tmpdir(),'asterisk-settle-'));db=await database(undefined,dir);await db.migrate();
  await db.rows('INSERT INTO runs(id,mode,run_day,card) VALUES($1,$2,$3,$4)',[run,'live',day,JSON.stringify({mode:'live'})]);
  for (const event of names) for (const ticker of tickers(event)) {
    await db.rows('INSERT INTO predictions VALUES($1,$2,$3)',[run,ticker,JSON.stringify({event,kickoff})]);
  }
  const existing=finals(names[2]!)[0]!;
  await db.rows('INSERT INTO settlements VALUES($1,$2,$3,$4,$5,$6)',[run,existing.ticker,existing.outcome,existing.closingPrior,existing.source,existing.settledAt]);
},60000);
afterAll(async()=>{await db?.close();if(dir)await rm(dir,{recursive:true,force:true});});
it('isolates outages, retries staggered and missing evidence, and reads all siblings including old finals',async()=>{
  const calls:string[]=[];
  const read=async(markets:{ticker:string;event:string}[])=>{
    const event=markets[0]!.event;calls.push(event);
    expect(markets.map(m=>m.ticker).sort()).toEqual(tickers(event).sort());
    if(event===names[0])throw Error('public upstream unavailable');
    if(event===names[1])return finals(event).slice(0,1);
    if(event===names[3])return finals(event).map(f=>({...f,closingPrior:null,closingNote:'no_common_pre_kickoff_quote'}));
    return finals(event);
  };
  expect(await settlePending(db,read)).toBe(5);
  expect(new Set(calls)).toEqual(new Set(names));
  expect(await settlePending(db,read)).toBe(0);
  expect(calls).toHaveLength(4);
  expect(await db.rows('SELECT * FROM settlements WHERE run_id=$1',[run])).toHaveLength(6);
  const waiting=await db.rows('SELECT event,attempts,next_check_at>now() AS delayed FROM settlement_checks ORDER BY event');
  expect(waiting).toMatchObject([{event:names[0],attempts:1,delayed:true},{event:names[1],attempts:1,delayed:true}]);
  await db.rows('UPDATE settlement_checks SET next_check_at=now()');
  expect(await settlePending(db,async m=>finals(m[0]!.event))).toBe(6);
  expect(await db.rows('SELECT * FROM settlement_checks')).toHaveLength(0);
},60000);
