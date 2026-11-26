import Fastify from 'fastify';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {z} from 'zod';
import {accountReaders} from './accounts.js';
import {paperMatchday} from './matchday.js';
import {loadRunDomain} from './domain.js';
import {correctionHistory} from './corrections.js';
import {consult} from './agent.js';
import {latest,performance,reserveConsult,finishConsult,Problem,type Mode} from './store.js';
import {loadPaperConfig,markdownCard,type EngineCard} from './pipeline.js';
import type {Database} from './db.js';

const body=z.object({question:z.string().trim().min(1).max(1800),sessionId:z.uuid().optional(),revision:z.number().int().min(0).optional()}).strict();
export function principals(raw:string|undefined):Map<string,string> {
  const entries=z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),z.string().min(32)).parse(JSON.parse(raw??'{}'));
  const keys=new Map<string,string>();
  for(const [principal,token] of Object.entries(entries)){
    if(keys.has(token))throw Error('Each analyst needs a separate access token');
    keys.set(token,principal);
  }
  return keys;
}
function digest(s:string){return createHash('sha256').update(s).digest();}
function nowCard(card:EngineCard,ttl:number):EngineCard{
  if(card.mode!=='live')return card;
  const now=Date.now();
  const markets=card.markets.map(m=>{
    const age=now-Date.parse(m.updated);
    const expired=!Number.isFinite(age)||age<0||age>ttl||!m.kickoff||Date.parse(m.kickoff)<=now;
    return expired?{...m,stake:0,contracts:0,decision:'no_bet' as const,reason:'stale_at_consultation'}:m;
  });
  return {...card,markets};
}
export async function application(db:Database,mode:Mode,keys:Map<string,string>,localDemo=false) {
  const api=Fastify({logger:false,bodyLimit:8192,requestTimeout:30000});
  const accounts=await accountReaders(mode==='live'&&!localDemo?JSON.parse(process.env.KALSHI_READ_ACCOUNTS??'{}'):{});
  const localKey=randomBytes(32).toString('hex');
  const config=await loadPaperConfig();
  if(localDemo)keys=new Map([...keys,[localKey,'local-demo']]);
  if(!keys.size)throw Error('Configure ASTERISK_USERS with a principal and a unique 32-character access token');
  const assets=new Map<string,[string,string]>();
  for(const [route,file,type] of [['/','index.html','text/html'],['/desk.css','desk.css','text/css'],['/desk.js','desk.js','text/javascript']]) {
    assets.set(route,[type,await readFile(new URL('../public/'+file,import.meta.url),'utf8')]);
  }
  const knownKeys=[...keys].map(([k,v])=>[digest(k),v] as const);
  const owners=new WeakMap<object,string>();
  api.setErrorHandler((err,_,reply)=>{
    const status=err instanceof Problem?err.statusCode:err instanceof z.ZodError?400:(err as {statusCode?:number}).statusCode??500;
    if(status>=500)console.error('Request failed',err instanceof Error?err.name:'error');
    return reply.status(status).send({error:err instanceof Problem?err.message:status>=500?'Service temporarily unavailable':'Invalid request'});
  });
  api.addHook('onRequest',async(req,reply)=>{
    reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer')
      .header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const host=req.headers.host??'';
    if(localDemo&&!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host))throw new Problem(403,'Use the loopback URL');
    if(req.method==='POST' && req.headers.origin && !['http://'+host,'https://'+host].includes(req.headers.origin))throw new Problem(403,'Origin denied');
    if(!req.url.startsWith('/api/')||req.url.split('?')[0]==='/api/local')return;
    const token=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]??req.headers.cookie?.match(/(?:^|;\s*)asterisk_local=([a-f0-9]+)/)?.[1];
    const principal=token?knownKeys.find(([hash])=>timingSafeEqual(hash,digest(token)))?.[1]:undefined;
    if(!principal)throw new Problem(401,'An analyst access token is required.');
    owners.set(req,principal);
  });
  for (const [route,[type,value]] of assets) api.get(route,(_,reply)=>reply.type(type).send(value));
  api.get('/health',async()=>{await db.rows('SELECT 1');return {ok:true,storage:db.kind,mode,tradingEnabled:false};});
  api.post('/api/local',async(req,reply)=>{
    if(!localDemo||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.ip))throw new Problem(404,'Unavailable');
    return reply.header('Set-Cookie','asterisk_local='+localKey+'; HttpOnly; SameSite=Strict; Path=/api').send({ok:true});
  });
  const snapshot=async()=>{const run=await latest(db,mode);if(!run)throw new Problem(503,'Awaiting first daily analysis');return {...run,card:nowCard(run.card,config.maxQuoteAgeMinutes*60000)};};
  api.get('/api/card',async()=>{const r=await snapshot();return {id:r.id,...r.card};});
  api.get('/api/matchday',async req=>{
    if(mode!=='live')throw new Problem(404,'Paper matchdays require live mode');
    const {date}=z.object({date:z.iso.date()}).strict().parse(req.query);
    return paperMatchday(db,date);
  });
  api.get('/api/domain',async()=>{const {id}=await snapshot();return {runId:id,domain:await loadRunDomain(db,id)};});
  api.get('/api/corrections',async()=>correctionHistory(db,mode,(await snapshot()).id));
  api.get('/api/card.md',async(_,reply)=>reply.type('text/markdown').send(markdownCard((await snapshot()).card)));
  api.get('/api/performance',async req=>{
    const q=z.object({from:z.iso.date().optional(),to:z.iso.date().optional()}).strict().parse(req.query);
    if(q.from&&q.to&&q.from>q.to)throw new Problem(400,'Invalid date range');
    return performance(db,mode,q.from,q.to);
  });
  api.get('/api/sessions/:id',async req=>{
    const {id}=z.object({id:z.uuid()}).parse(req.params);
    const [session]=await db.rows('SELECT id,revision,previous_tool FROM sessions WHERE id=$1 AND principal=$2 AND mode=$3 AND expires_at>now()',[id,owners.get(req),mode]);
    if(!session)throw new Problem(404,'Session unavailable');
    const turns=await db.rows('SELECT revision,tool,answer,created_at FROM turns WHERE session_id=$1 ORDER BY revision DESC LIMIT 20',[id]);
    return {...session,turns:turns.reverse()};
  });
  api.post('/api/consult',async req=>{
    const {question,sessionId,revision}=body.parse(req.body);
    const principal=owners.get(req)!;
    const s=await reserveConsult(db,principal,mode,sessionId,revision);
    const run=await snapshot(), c=run.card;
    const evidence={mode,source:c.source,modelVersion:c.modelVersion,asOf:c.asOf,status:c.status,simulated:c.simulation};
    const read=async(tool:string)=>{
      switch(tool) {
        case 'get_performance':return {...evidence,...await performance(db,mode)};
        case 'get_run_status':return {...evidence,providers:c.providers,runId:run.id,marketCount:c.markets.length,storage:db.kind};
        case 'get_positions':return {...evidence,...await accounts(principal)};
        case 'list_markets':return {...evidence,markets:c.markets.map(({ticker,label,match,ask,bid,updated,source})=>({ticker,label,match,ask,bid,updated,source}))};
        case 'get_pick_card':case 'explain_prediction':return c;
        default:throw new Problem(400,'Unknown read tool');
      }
    };
    const result=await consult({question,previousTool:s.previousTool,read,audit:async(tool,status,hash,ms)=>{
      await db.rows('INSERT INTO tool_audit(session_id,principal,tool,status,input_hash,duration_ms) VALUES($1,$2,$3,$4,$5,$6)',[s.id,principal,tool,status,hash,Math.round(ms)]);
    }});
    await finishConsult(db,principal,s.id,s.revision,result.tool??'none',result.answer,run.id);
    return {...result,sessionId:s.id,revision:s.revision+1};
  });
  return api;
}
