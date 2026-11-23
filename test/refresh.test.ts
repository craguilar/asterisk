import {it,expect,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {evaluateQuotes,loadPaperConfig} from '../src/pipeline.js';
import {daily} from '../src/store.js';
import {database} from '../src/db.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

it('protects paper cash on a refresh that sees the same book again',async()=>{
  const replay=JSON.parse(await readFile('data/replay.json','utf8'));
  const at=new Date(replay.asOf),cfg=await loadPaperConfig();
  const quotes=replay.markets.map((m:any)=>({...m,event:replay.eventTicker,title:m.label,updated:m.asOf,open:m.asOf,close:replay.match.kickoff,status:'active',last:null,askSize:100,ask:m.label==='Toluca'?.25:m.ask,bid:null}));
  const match={...replay.match,lambdaHome:2.2,lambdaAway:1,rho:0,aliasesHome:[],aliasesAway:[]};
  const first=evaluateQuotes(quotes,[match],at,cfg,'fixture');
  const spent=first.filter(m=>m.stake>0).map(m=>({...m,today:true}));expect(spent.length).toBeGreaterThan(0);
  const next=evaluateQuotes(quotes,[match],at,cfg,'fixture',{},spent);
  for(const p of spent)expect(next.find(m=>m.ticker===p.ticker)).toMatchObject({stake:0,reason:'paper_position_recorded'});
});
it('can refresh a saved empty live day while keeping the original ledger record',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'asterisk-refresh-'));
  const db=await database(undefined,temp);
  const mocked=vi.spyOn(globalThis,'fetch').mockImplementation(async url=>String(url).includes('kalshi')?Response.json({markets:[],cursor:''}):Response.json({events:[]}));
  try{
    await db.migrate();const t=new Date('2026-11-23T14:00:00Z');
    const lockKeys=new Set<unknown>();
    const wrapped={...db,transaction:<T>(fn:(s:import('../src/db.js').Sql)=>Promise<T>)=>db.transaction(s=>fn({
      rows:<R extends import('../src/db.js').Row>(query:string,args?:unknown[])=>{
        if(query.includes('pg_advisory_xact_lock(hashtext'))lockKeys.add(args?.[0]);
        return s.rows<R>(query,args);
      }
    }))};
    const a=await daily(wrapped,'live',t),duplicate=await daily(db,'live',t),b=await daily(db,'live',new Date(+t+120000));
    expect(a.id).toBe(duplicate.id);expect(b.id).not.toBe(a.id);
    const c=await daily(db,'live',new Date(+t+121000),true);expect(c.id).not.toBe(b.id);
    expect(await db.rows('SELECT id FROM runs')).toHaveLength(3);
    await Promise.all([daily(wrapped,'live',new Date('2026-11-23T23:59:59Z')),daily(wrapped,'live',new Date('2026-11-24T00:00:01Z'))]);
    expect([...lockKeys]).toHaveLength(1);
  }finally{mocked.mockRestore();await db.close();await rm(temp,{recursive:true,force:true});}
},40000);
