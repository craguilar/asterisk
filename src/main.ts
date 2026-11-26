import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {database} from './db.js';
import {paperMatchday} from './matchday.js';
import {recordCorrection} from './corrections.js';
import {application,principals} from './app.js';
import {daily,latest,type Mode} from './store.js';
import {markdownCard} from './pipeline.js';
import {refreshWeights} from './weights.js';
import {settlePending} from './settlement-job.js';

async function main(){
  const cmd=process.argv[2]??'serve';
  const mode=(process.env.ASTERISK_MODE??(cmd==='demo'?'replay':'live')) as Mode;
  if(!['live','replay','demo'].includes(mode))throw Error('Unknown ASTERISK_MODE');
  if(cmd==='consult'){
    const url=new URL('/api/consult',process.env.ASTERISK_URL??'http://127.0.0.1:3000');
    if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw Error('HTTPS required for remote consultation');
    const r=await fetch(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+(process.env.ASTERISK_TOKEN??'')},body:JSON.stringify({question:process.argv.slice(3).join(' ')||'Show run status'})});
    if(!r.ok)throw Error('Consultation HTTP '+r.status);
    console.log(JSON.stringify(await r.json(),null,2));return;
  }
  if(!['serve','demo','daily','migrate','correct','paper-day'].includes(cmd))throw Error('Unknown command');
  const local=cmd==='demo';
  const db=await database(process.env.DATABASE_URL,local?resolve(process.env.ASTERISK_DEMO_DIR??'.asterisk/pg'):undefined);
  let serving=false;
  try{
    await db.migrate();
    if(cmd==='migrate')return;
    if(cmd==='paper-day'){
      console.log(JSON.stringify(await paperMatchday(db,process.argv[3]??''),null,2));return;
    }
    if(cmd==='correct'){
      if(!process.argv[3])throw Error('Supply the path to a correction JSON file.');
      const audit=await recordCorrection(db,JSON.parse(await readFile(process.argv[3],'utf8')));
      console.log(JSON.stringify({runId:audit.run_id,ticker:audit.ticker,revision:audit.revision}));return;
    }
    if(cmd==='daily'){
      const run=await daily(db,mode,new Date(),process.argv.includes('--refresh'));
      const settled=mode==='live'?await settlePending(db):0;
      if(mode==='live')await refreshWeights(db);
      const dir=resolve(process.env.ASTERISK_REPORT_DIR??'reports');await mkdir(dir,{recursive:true});
      const base=dir+'/card-'+mode+'-'+run.card.asOf.slice(0,10);
      await writeFile(base+'.json',JSON.stringify(run.card,null,2));await writeFile(base+'.md',markdownCard(run.card));
      console.log(JSON.stringify({id:run.id,asOf:run.card.asOf,mode,status:run.card.status,markets:run.card.markets.length,settled}));
      if(run.card.status==='unavailable')process.exitCode=1;
      return;
    }
    const api=await application(db,mode,principals(process.env.ASTERISK_USERS),local);
    if(local||!await latest(db,mode))await daily(db,mode);
    const address=await api.listen({port:Number(process.env.PORT??(local?4317:3000)),host:local?'127.0.0.1':'0.0.0.0'});
    serving=true;console.log('Asterisk '+mode+' · '+address+' · '+db.kind);
    let refreshing:Promise<void>|undefined;
    const timer=local && mode==='live'?setInterval(()=>{
      if(refreshing)return;
      refreshing=(async()=>{await daily(db,'live',new Date(),true);await settlePending(db);await refreshWeights(db);})()
        .catch(()=>console.error('Live refresh failed. The next interval will retry.')).finally(()=>{refreshing=undefined;});
    },15*60_000):undefined;
    const stop=async()=>{clearInterval(timer);await api.close();await refreshing;await db.close();};
    process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
  } finally {if(!serving)await db.close();}
}
main().catch((e:unknown)=>{console.error(e instanceof Error?e.message:'Startup failed');process.exitCode=1;});
