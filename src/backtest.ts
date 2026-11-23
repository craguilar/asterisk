import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { espnResults, extendArchive, fit, forecast, history, scoreboard, teamName, type Result } from './football.js';
import { scoreGrid, combine, normalize } from './math.js';

type Observation = { p: number[]; actual: number };
function performance(rows: Observation[]) {
  if (!rows.length) return { samples:0, logLoss:null, brier:null };
  return {samples: rows.length,
    logLoss:rows.reduce((s,r)=>s-Math.log(Math.max(1e-12,r.p[r.actual])),0)/rows.length,
    brier:rows.reduce((s,r)=>s+r.p.reduce((t,p,i)=>t+(p-Number(i===r.actual))**2,0),0)/rows.length};
}
const actual = (r: Result) => r.hg > r.ag ? 0 : r.hg === r.ag ? 1 : 2;
const DAY = 86_400_000;
export function archiveBacktest() {
  const all = history();
  const output=[];
  for (const tournament of ['Apertura','Clausura']) {
    const heldOut=all.filter(r=>r.season==='2024-25' && r.stage.startsWith(tournament));
    const empirical: Observation[]=[], model: Observation[]=[];
    for (const date of [...new Set(heldOut.map(r=>r.date))].sort()) {
      const asOf=date+'T00:00:00Z', time=Date.parse(asOf);
      const fitted=fit(all,asOf), prior=[1,1,1];
      for (const g of all) if(g.availableAt < time && time-g.availableAt<=1461*DAY) prior[actual(g)]++;
      for (const g of heldOut.filter(r=>r.date===date)) {
        const {lambdaHome,lambdaAway,rho}=forecast(fitted,g.home,g.away);
        if (lambdaHome===null || lambdaAway===null) continue;
        const p=scoreGrid(lambdaHome,lambdaAway,rho);
        model.push({p:[p.home,p.draw,p.away],actual:actual(g)});
        empirical.push({p:normalize(prior),actual:actual(g)});
      }
    }
    output.push({tournament:tournament+' 2024–25',scheduled:heldOut.length,completed:model.length,
      leagueFrequencyBaseline:performance(empirical),dixonColes:performance(model),market:null,combined:null});
  }
  return {source:'OpenFootball CC0',coverage:'All regulation results, including knockout rounds. No exchange prices in the results archive.',results:output};
}

type ListedMarket={ticker:string;event_ticker:string;yes_sub_title:string;rules_primary:string};
type Candle={end_period_ts:number;yes_ask?:{close?:string;close_dollars?:string}};
const API='https://api.elections.kalshi.com/trade-api/v2/';
const cache=resolve(process.env.ASTERISK_EVAL_CACHE ?? '.asterisk-eval-cache');
async function cached<T>(key:string, get:()=>Promise<T>):Promise<T> {
  await mkdir(cache,{recursive:true});
  const file=resolve(cache,createHash('sha256').update(key).digest('hex')+'.json');
  try {return JSON.parse(await readFile(file,'utf8'));} catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  const data=await get(); await writeFile(file,JSON.stringify(data)); return data;
}
async function publicRead<T>(path:string):Promise<T> {
  return cached(API+path,async()=>{
    for(let i=0;i<5;i++) {
      const r=await fetch(new URL(path,API),{signal:AbortSignal.timeout(20000),redirect:'error'});
      if(r.ok)return r.json();
      if(![429,500,502,503,504].includes(r.status) || i===4) throw Error('Archive request failed: HTTP '+r.status+' '+path);
      await new Promise(resolve=>setTimeout(resolve,500*2**i));
    }
    throw Error('Archive retry exhausted');
  });
}
async function oldMarkets() {
  const all:ListedMarket[]=[];
  let cursor='';
  const seen=new Set<string>();
  do {
    const q=new URLSearchParams({series_ticker:'KXLIGAMXGAME',limit:'1000'});
    if(cursor)q.set('cursor',cursor);
    const page: {markets:ListedMarket[];cursor:string}=await publicRead('historical/markets?'+q);
    if(!Array.isArray(page.markets))throw Error('Missing historical markets');
    all.push(...page.markets);
    cursor=page.cursor;
    if(cursor && seen.has(cursor))throw Error('Repeated historical cursor');
    seen.add(cursor);
  } while(cursor);
  return all;
}
function contractDate(ticker:string) {
  const m=/^KXLIGAMXGAME-(\d{2})([A-Z]{3})(\d{2})/.exec(ticker);
  if(!m)return NaN;
  const month=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(m[2]);
  return month<0?NaN:Date.UTC(2000+Number(m[1]),month,Number(m[3]));
}
async function askAt(m:ListedMarket, at:number) {
  const cutoff=Math.floor(at/1000);
  // Require a completed hour at most two hours before forecast time; no fills or closing price proxies.
  const q=new URLSearchParams({period_interval:'60',start_ts:String(cutoff-7200),end_ts:String(cutoff)});
  const res=await publicRead<{candlesticks:Candle[]}>('historical/markets/'+encodeURIComponent(m.ticker)+'/candlesticks?'+q);
  const last=res.candlesticks.filter(c=>c.end_period_ts<=cutoff && c.end_period_ts>=cutoff-7200).sort((a,b)=>b.end_period_ts-a.end_period_ts)[0];
  const price=Number(last?.yes_ask?.close_dollars??last?.yes_ask?.close);
  return price>0 && price<1?price:null;
}
export async function exchangeBacktest() {
  const events=(await Promise.all([2025,2026].map(y=>cached('espn-season-v1-'+y,()=>scoreboard(String(y)))))).flat();
  const archive=extendArchive(history(),events);
  const results=espnResults(events);
  const markets=await oldMarkets();
  const groups=new Map<string,ListedMarket[]>();
  for(const m of markets) {
    if(!m.ticker.startsWith('KXLIGAMXGAME-')) continue;
    groups.set(m.event_ticker,[...(groups.get(m.event_ticker)??[]),m]);
  }
  const summaries=[];
  for (const [name,start,end] of [['Apertura 2025','2025-07-01','2026-01-01'],['Clausura 2026','2026-01-01','2026-07-01']]) {
    const period=results.filter(g=> g.availableAt-DAY>=Date.parse(start) && g.availableAt-DAY<Date.parse(end));
    const market:Observation[]=[],model:Observation[]=[],combined:Observation[]=[];
    const exclusions={unlinked:0,unrated:0,missingQuote:0};
    let contracts=0;
    const forecasts=new Map<string,ReturnType<typeof fit>>();
    for(const [ticker,group] of [...groups].sort()) {
      const date=contractDate(ticker);
      if(!(date>=Date.parse(start) && date<Date.parse(end)))continue;
      contracts++;
      if(group.length!==3 || !group.every(m=>/90 minutes/i.test(m.rules_primary))) {exclusions.unlinked++;continue;}
      const byLabel=new Map(group.map(m=>[teamName(m.yes_sub_title),m]));
      const candidates=period.filter(g=>byLabel.has(g.home) && byLabel.has(g.away) && byLabel.has('Tie') &&
        g.availableAt-DAY>=date && g.availableAt-DAY<date+2*DAY);
      if(candidates.length!==1){exclusions.unlinked++;continue;}
      const g=candidates[0];
      const cutoff=g.availableAt-DAY-2*3600_000;
      const day=new Date(cutoff).toISOString().slice(0,10)+'T00:00:00Z';
      const ratings=forecasts.get(day)??fit(archive,day);forecasts.set(day,ratings);
      const {lambdaHome,lambdaAway,rho}=forecast(ratings,g.home,g.away);
      if(lambdaHome===null || lambdaAway===null){exclusions.unrated++;continue;}
      const prices=await Promise.all([g.home,'Tie',g.away].map(side=>askAt(byLabel.get(side)!,cutoff)));
      if(!prices.every((p):p is number=>p!==null)){exclusions.missingQuote++;continue;}
      const p=scoreGrid(lambdaHome,lambdaAway,rho), prediction=[p.home,p.draw,p.away], baseline=normalize(prices);
      const observation={actual:actual(g)};
      market.push({...observation,p:baseline}); model.push({...observation,p:prediction});
      combined.push({...observation,p:normalize(baseline.map((v,i)=>combine(v,prediction[i],0.7,0)))});
    }
    summaries.push({tournament:name,regulationResults:period.length,listedEvents:contracts,exclusions,market:performance(market),
      model:performance(model),combined:performance(combined)});
  }
  return {source:'ESPN, OpenFootball, Kalshi historical market candlesticks',type:'Retrospective market-covered sample',
    method:'All matched three-way regulation markets with strictly pre-kickoff, non-extreme hour-close asks by two hours before kickoff. Daily refits. Multiclass Brier sum and natural-log loss. Fixed 70% normalized market weight, zero unobserved rule adjustments. No fees, fill assumptions or realized returns.',results:summaries};
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.includes('--replay-ratings')) {
    const events=(await Promise.all([2025,2026].map(y=>cached('espn-season-v1-'+y,()=>scoreboard(String(y)))))).flat();
    console.log(JSON.stringify(fit(extendArchive(history(),events),'2026-11-07T16:00:00.000Z'),null,2));
  } else {
    console.log(JSON.stringify(process.argv.includes('--exchange') ? await exchangeBacktest() : archiveBacktest(),null,2));
  }
}
