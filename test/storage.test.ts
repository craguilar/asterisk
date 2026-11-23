import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {database,type Database} from '../src/db.js';
import {daily} from '../src/store.js';
import {application} from '../src/app.js';
import type {FastifyInstance} from 'fastify';

for(const backend of ['embedded',...(process.env.TEST_DATABASE_URL?['server']:[])])describe('persisted HTTP workflow on '+backend,()=>{
  let db:Database,api:FastifyInstance,dir:string,id:string,revision:number;
  const a=randomUUID(),b=randomUUID(),keys=new Map([[a,'test-'+randomUUID()],[b,'test-'+randomUUID()]]);
  const auth=(key:string)=>({authorization:'Bearer '+key,host:'localhost'});
  const open=()=>database(backend==='server'?process.env.TEST_DATABASE_URL:undefined,dir);
  beforeAll(async()=>{dir=await mkdtemp(join(tmpdir(),'asterisk-test-'));db=await open();await db.migrate();api=await application(db,'replay',keys);},60000);
  afterAll(async()=>{await api?.close();await db?.close();if(dir)await rm(dir,{recursive:true,force:true});});
  it('commits one historical run, its snapshots and separate outcomes, even across overlapping daily invocations',async()=>{
    const [first,second]=await Promise.all([daily(db,'replay'),daily(db,'replay')]);
    expect(first.id).toBe(second.id);
    const rows=await db.rows('SELECT ticker,observation FROM predictions WHERE run_id=$1',[first.id]);
    expect(rows).toHaveLength(3);expect(rows.every(r=>r.observation.model>0&&r.observation.stake===0)).toBe(true);
    expect(await db.rows('SELECT outcome FROM settlements WHERE run_id=$1',[first.id])).toHaveLength(3);
    await expect(db.rows("UPDATE predictions SET observation='{}' WHERE run_id=$1",[first.id])).rejects.toThrow(/immutable/i);
  },60000);
  it('requires authentication, isolates sessions, and rejects stale revisions',async()=>{
    expect((await api.inject('/api/card')).statusCode).toBe(401);
    expect((await api.inject({method:'POST',url:'/api/local'})).statusCode).toBe(404);
    const card=await api.inject({url:'/api/card',headers:auth(a)});expect(card.json().mode).toBe('replay');
    const call=(key:string,payload:object)=>api.inject({method:'POST',url:'/api/consult',headers:auth(key),payload});
    const initial=await call(a,{question:'Explain the Toluca probability'});expect(initial.statusCode).toBe(200);
    ({sessionId:id,revision}=initial.json());expect(initial.json().tool).toBe('explain_prediction');
    expect((await call(b,{question:'more',sessionId:id,revision})).statusCode).toBe(404);
    expect((await api.inject({url:'/api/sessions/'+id,headers:auth(b)})).statusCode).toBe(404);
    const payload={question:'more',sessionId:id,revision};
    const results=await Promise.all([call(a,payload),call(a,payload)]);
    expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);revision++;
    const p=(await api.inject({url:'/api/performance',headers:auth(a)})).json();
    expect(p.settledContracts).toBe(3);expect(p.market.count).toBe(3);expect(p.model.count).toBe(3);
  });
  it('recovers the stored card, principal session and follow-up tool after reopening the database',async()=>{
    await api.close();await db.close();db=await open();await db.migrate();api=await application(db,'replay',keys);
    const session=await api.inject({url:'/api/sessions/'+id,headers:auth(a)});
    expect(session.json().revision).toBe(revision);expect(session.json().turns).toHaveLength(2);
    const follow=await api.inject({method:'POST',url:'/api/consult',headers:auth(a),payload:{sessionId:id,revision,question:'more'}});
    expect(follow.json().tool).toBe('explain_prediction');
    expect((await api.inject({url:'/api/card',headers:auth(a)})).json().markets).toHaveLength(3);
  },30000);
});
