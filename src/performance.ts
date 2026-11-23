import {readFile} from 'node:fs/promises';
import type {Sql} from './db.js';
import type {Mode} from './store.js';
import {attribution} from './weights.js';

export interface SettledForecast {
  day:string;as_of:string;run_id:string;ticker:string;
  m:{prior:number|null;model:number|null;probability:number|null;ask:number|null;decision:string;contracts:number;stake:number;kickoff:string|null};
  outcome:number;close_prior:number|null;source:string;settled_at:string|Date;
}
const probability=(value:unknown):value is number=>typeof value==='number' && Number.isFinite(value) && value>=0 && value<=1;
const money=(value:number)=>Math.round(value*1_000_000)/1_000_000;
const validWindow=(day:string,from?:string,to?:string)=>(!from||day>=from)&&(!to||day<=to);

function score(rows:SettledForecast[],field:'prior'|'model'|'probability') {
  let brier=0,logLoss=0,count=0;
  const bins=new Map<number,{n:number,total:number,yes:number}>();
  for(const r of rows){
    const p=r.m[field];
    if(!probability(p)) continue;
    brier+=(p-r.outcome)**2;
    const bounded=Math.min(1-1e-12,Math.max(1e-12,p));
    logLoss-=r.outcome?Math.log(bounded):Math.log1p(-bounded);
    const bucket=Math.min(9,Math.floor(p*10));
    const bin=bins.get(bucket)??{n:0,total:0,yes:0};
    bin.n++;bin.total+=p;bin.yes+=r.outcome;bins.set(bucket,bin);
    count++;
  }
  return count?{count,brier:brier/count,logLoss:logLoss/count,
    calibration:[...bins].sort(([a],[b])=>a-b).map(([bucket,b])=>({bucket,count:b.n,predicted:b.total/b.n,observed:b.yes/b.n}))}:null;
}

export function summarizeSettled(rows:SettledForecast[],mode:Mode,from?:string,to?:string) {
  const first=new Map<string,SettledForecast>();
  const pickStats=new Map<string,{entry:SettledForecast;observedContracts:number;clvTotal:number}>();
  const sources=new Set<string>();
  const realizedPositions=[];
  for(const r of [...rows].sort((a,b)=>Date.parse(a.as_of)-Date.parse(b.as_of)||a.run_id.localeCompare(b.run_id)||a.ticker.localeCompare(b.ticker))){
    const at=Date.parse(r.as_of);
    if(![0,1].includes(r.outcome)||!(at<new Date(r.settled_at).valueOf())||!r.m.kickoff||!(at<Date.parse(r.m.kickoff))) continue;
    if(!first.has(r.ticker) && probability(r.m.prior) && probability(r.m.probability)) first.set(r.ticker,r);
    if(!validWindow(r.day,from,to)) continue;
    sources.add(r.source);
    const {contracts,stake,ask}=r.m;
    if(r.m.decision!=='paper_pick'||!Number.isSafeInteger(contracts)||contracts<=0||!Number.isFinite(stake)||stake<=0) continue;
    const clv=probability(r.close_prior)&&probability(ask)?r.close_prior-ask:null;
    realizedPositions.push({predictionDay:r.day,runId:r.run_id,ticker:r.ticker,contracts,stake,outcome:r.outcome,
      realizedPnl:money(contracts*r.outcome-stake),clv,source:r.source});
    const stat=pickStats.get(r.ticker)??{entry:r,observedContracts:0,clvTotal:0};
    if(clv!==null){stat.observedContracts+=contracts;stat.clvTotal+=contracts*clv;}
    pickStats.set(r.ticker,stat);
  }
  const forecasts=[...first.values()].filter(r=>validWindow(r.day,from,to));
  // Compare one independently settled ticker once. Repeated simulated entries in that ticker
  // contribute their own cash flows and their contract-weighted CLV.
  const measured=[...pickStats.values()].filter(s=>s.observedContracts>0);
  const meanClv=measured.length?measured.reduce((s,p)=>s+p.clvTotal/p.observedContracts,0)/measured.length:null;
  const matched=measured.filter(s=>probability(s.entry.m.prior)&&probability(s.entry.m.probability));
  const gateMarket=score(matched.map(s=>s.entry),'prior');
  const gateCombined=score(matched.map(s=>s.entry),'probability');
  const gateClv=matched.length?matched.reduce((sum,p)=>sum+p.clvTotal/p.observedContracts,0)/matched.length:null;
  return {mode,from:from??null,to:to??null,settledContracts:forecasts.length,settledPaperPicks:pickStats.size,uniquePicksWithClv:measured.length,
    market:score(forecasts,'prior'),model:score(forecasts,'model'),combined:score(forecasts,'probability'),meanClv,
    realizedPositions,realizedPnl:money(realizedPositions.reduce((sum,p)=>sum+p.realizedPnl,0)),
    gateSample:{uniqueTickers:matched.length,meanClv:gateClv,marketLogLoss:gateMarket?.logLoss??null,combinedLogLoss:gateCombined?.logLoss??null},
    tradingEnabled:false,gateEvidenceEligible:mode==='live'&&matched.length>=100&&gateClv!==null&&gateClv>0&&
      gateMarket!==null&&gateCombined!==null&&gateCombined.logLoss<gateMarket.logLoss,sources:[...sources]};
}

export async function performance(sql:Sql,mode:Mode,from?:string,to?:string) {
  // Keep earlier forecasts in the population until the first eligible entry per ticker
  // is known. Filtering the lower bound here would score a later forecast twice.
  const rows=await sql.rows<SettledForecast>(`WITH final AS (
    SELECT DISTINCT ON (s.ticker) s.ticker,s.outcome,s.close_prior,s.source,s.settled_at
      FROM settlements s JOIN runs r ON r.id=s.run_id WHERE r.mode=$1
      ORDER BY s.ticker,(s.close_prior IS NOT NULL) DESC,s.settled_at,s.run_id)
    SELECT p.ticker,p.run_id,p.observation AS m,r.run_day::text AS day,r.card->>'asOf' AS as_of,
           s.outcome,s.close_prior,s.source,s.settled_at
      FROM predictions p JOIN runs r ON r.id=p.run_id JOIN final s ON s.ticker=p.ticker
      WHERE r.mode=$1 AND ($2::date IS NULL OR r.run_day<=$2::date)`,[mode,to??null]);
  return {...summarizeSettled(rows,mode,from,to),historicalBenchmark:JSON.parse(await readFile(new URL('../data/backtest-exchange.json',import.meta.url),'utf8')),
    perRule:await attribution(sql,mode,{from,to})};
}
