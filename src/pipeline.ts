import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { footballContext } from './football.js';
import { loadMatchEvidence, type VerifiedFlag } from './news.js';
import { readMarkets, MARKETS_URL, SERIES, type Quote } from './kalshi.js';
import { combine, edge, kelly, normalize, scoreGrid } from './math.js';
import { adjustment, evaluateRules, type RuleFacts, type RuleFire, type Result } from './rules.js';

export type Mode = 'live' | 'demo' | 'replay';
type MatchContext = Awaited<ReturnType<typeof import('./football-details.js').matchDetail>>['matchContext'];
export interface Allocation {ticker:string; match:string|null; kickoff:string|null; stake:number; today:boolean}
export interface Match {
  home:string; away:string; kickoff:string; aliasesHome:string[]; aliasesAway:string[];
  lambdaHome:number|null; lambdaAway:number|null; rho:number; matchContext?:MatchContext; ratingVersion?:string|null; trainedThrough?:string|null; facts?:RuleFacts; newsFlags?:VerifiedFlag[];
}
const configSchema = z.object({
  bankroll:z.number().positive(), perBetCap:z.number().nonnegative(), dailyCap:z.number().nonnegative(),
  kellyMultiplier:z.number().min(0).max(1), marketWeight:z.number().min(0).max(1), minEdge:z.number().min(0).max(1),
  feeRate:z.number().min(0).max(1), maxQuoteAgeMinutes:z.number().positive(), horizonHours:z.number().positive(),
  series:z.literal(SERIES), tradingEnabled:z.literal(false),
}).strict();
export type RiskConfig = z.infer<typeof configSchema>;
export async function loadPaperConfig(): Promise<RiskConfig> {
  return configSchema.parse(JSON.parse(await readFile('config/paper.json','utf8')));
}
const price = z.number().min(0).max(1).nullable();
const replaySchema = z.object({asOf:z.string().datetime(), eventTicker:z.string().startsWith(SERIES+'-'),
  source:z.string(), match:z.object({home:z.string(),away:z.string(),kickoff:z.string().datetime()}),
  markets:z.array(z.object({ticker:z.string(),label:z.string(),ask:price,bid:price,asOf:z.string().datetime(),
    volume:z.number().nonnegative().nullable(),rules:z.string(),source:z.string()})).length(3)});
export interface CardMarket {
  ticker:string; title:string; label:string; event:string; match:string|null; kickoff:string|null;
  ask:number|null; bid:number|null; last:number|null; volume:number|null; askSize:number|null; updated:string;
  rulesText:string; marketStatus:string; source:string; outcome:Result|null; prior:number|null; model:number|null;
  probability:number|null; overround:number|null; fee:number|null; edge:number|null; stake:number; contracts:number;
  decision:'no_bet'|'paper_pick'; reason:string; rules:RuleFire[]; ruleAdjustment:number;
  goals:{home:number;away:number;rho:number}|null; matchContext?:MatchContext; ratingVersion?:string|null; trainedThrough?:string|null; risks:string[]; cancelIf:string[]; uncertainty:string[]; newsFlags?:VerifiedFlag[];
}
export interface EngineCard {
  asOf:string; mode:Mode; source:string; footballSource:string; modelVersion:string; status:'ready'|'empty'|'unavailable'|'partial';
  providers:{market:string;football:string;news:string}; markets:CardMarket[]; bankroll:number; dailyCap:number; exposure:number;
  disclaimer:string; tradingEnabled:false; simulation:boolean; marketWeight:number; weightVersion:string;
}
const clean = (s:string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
function outcome(label:string,m:Match): Result|null {
  const n = clean(label);
  if (n === 'tie' || n === 'draw' || n === 'empate') return 'draw';
  const h = [m.home,...m.aliasesHome].some(a => clean(a) === n);
  const a = [m.away,...m.aliasesAway].some(a => clean(a) === n);
  return h !== a ? (h ? 'home' : 'away') : null;
}
function tradingDay(date:string) {
  // Kalshi event tickers encode the scheduled US Eastern calendar date.
  const d = new Date(date);
  if (!Number.isFinite(d.valueOf())) return '';
  const parts = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'2-digit',month:'short',day:'2-digit'}).formatToParts(d);
  const part = (key:string) => parts.find(p => p.type === key)?.value ?? '';
  return (part('year')+part('month')+part('day')).toUpperCase();
}
function blank(q:Quote, source:string):CardMarket {
  return {ticker:q.ticker,title:q.title,label:q.label,event:q.event,match:null,kickoff:null,
    ask:q.ask,bid:q.bid,last:q.last,volume:q.volume,askSize:q.askSize,updated:q.updated,rulesText:q.rules,marketStatus:q.status,source,
    outcome:null,prior:null,model:null,probability:null,overround:null,fee:null,edge:null,stake:0,contracts:0,
    decision:'no_bet',reason:'unlinked',rules:[],ruleAdjustment:0,goals:null,risks:[],cancelIf:[],uncertainty:[]};
}
function badGroup(group:Quote[], at:number, cfg:RiskConfig) {
  if (group.length !== 3 || new Set(group.map(q=>q.ticker)).size !== 3) return 'incomplete_outcomes';
  if (group.some(q=>!['open','active'].includes(q.status) || !(Date.parse(q.open) <= at && Date.parse(q.close) > at))) return 'market_closed';
  if (group.some(q=>!/90 minutes|regulation time/i.test(q.rules))) return 'unsupported_settlement';
  if (group.some(q=>!Number.isFinite(Date.parse(q.updated)) || Date.parse(q.updated)>at || at-Date.parse(q.updated)>cfg.maxQuoteAgeMinutes*60000)) return 'stale_quote';
  if (group.some(q=>q.ask===null || q.ask<=0 || q.ask>=1 || (q.bid!==null && q.bid>q.ask))) return 'invalid_quote';
  return null;
}
export function evaluateQuotes(quotes:Quote[], matches:Match[], at:Date, cfg:RiskConfig, source:string, weights:Readonly<Record<string,number>> = {}, previous:Allocation[]=[]) {
  const groups = new Map<string,Quote[]>();
  for (const q of quotes) groups.set(q.event,[...(groups.get(q.event)??[]),q]);
  const rows:CardMarket[] = [];
  for (const [event, group] of [...groups].sort(([a],[b])=>a.localeCompare(b))) {
    const cards = group.map(q=>blank(q,source));
    rows.push(...cards);
    const day = event.split('-')[1]?.slice(0,7) ?? '';
    const candidates = matches.filter(m => tradingDay(m.kickoff) === day && group.some(q=>outcome(q.label,m)==='home') && group.some(q=>outcome(q.label,m)==='away'));
    if (candidates.length !== 1) continue;
    const m = candidates[0]!, kickoff = Date.parse(m.kickoff);
    let invalid = badGroup(group,at.valueOf(),cfg);
    if (kickoff<=at.valueOf()) invalid='match_started';
    else if (kickoff-at.valueOf()>cfg.horizonHours*3600000) invalid='outside_horizon';
    const outcomes = group.map(q=>outcome(q.label,m));
    if (!invalid && (outcomes.includes(null) || new Set(outcomes).size !== 3)) invalid='incomplete_outcomes';
    cards.forEach((c,i) => Object.assign(c,{match:m.home+' vs '+m.away,kickoff:m.kickoff,outcome:outcomes[i],newsFlags:m.newsFlags,matchContext:m.matchContext,ratingVersion:m.ratingVersion,trainedThrough:m.trainedThrough,reason:invalid??'no_edge'}));
    if (invalid) continue;
    const prices = group.map(q=>q.ask!), priors = normalize(prices);
    const overround = prices.reduce((a,b)=>a+b,0)-1;
    let grid: ReturnType<typeof scoreGrid>|null = null;
    if (m.lambdaHome !== null && m.lambdaAway !== null) {
      try { grid=scoreGrid(m.lambdaHome,m.lambdaAway,m.rho); }
      catch { /* Keep the prior and explicitly flag an unusable model. */ }
    }
    const favorite = priors[outcomes.indexOf('home')]! >= priors[outcomes.indexOf('away')]! ? 'home' : 'away';
    const fires = m.facts ? evaluateRules({...m.facts, favorite},weights) : [];
    const blended = normalize(cards.map((c,i)=>{
      const prior = priors[i]!, model = grid?.[c.outcome!] ?? null;
      c.prior=prior; c.model=model; c.overround=overround;
      c.rules=fires.filter(f=>f.target===c.outcome || f.target==='context');
      c.ruleAdjustment=adjustment(fires,c.outcome!);
      if (grid) c.goals={home:m.lambdaHome!,away:m.lambdaAway!,rho:m.rho};
      if (!m.facts) c.uncertainty.push('No verified news or lineup evidence.');
      return combine(prior,model??prior,cfg.marketWeight,c.ruleAdjustment);
    }));
    for (const [i,c] of cards.entries()) {
      c.probability=blended[i]!;
      // Round per contract conservatively when computing the entry hurdle.
      c.fee=Math.ceil(100*cfg.feeRate*c.ask!*(1-c.ask!)-1e-12)/100;
      c.edge=edge(c.probability,c.ask!,c.fee);
      if (!grid) c.reason='model_missing';
      else if (c.askSize===null || c.askSize<1) c.reason='depth_unavailable';
      else if (c.edge < cfg.minEdge || c.edge<=0) c.reason=c.edge<=0?'no_edge':'edge_below_threshold';
      else c.reason='eligible';
    }
  }
  // Allocate paper exposure across events in descending net edge order.
  let spent=previous.reduce((s,p)=>s+(p.today?p.stake:0),0);
  const matchSpend=new Map<string,number>();
  const allocated=new Set(previous.map(p=>p.ticker));
  for(const p of previous){const key=p.match+'|'+p.kickoff;matchSpend.set(key,(matchSpend.get(key)??0)+p.stake);}
  for (const c of rows.filter(r=>r.reason==='eligible').sort((a,b)=>b.edge!-a.edge! || a.ticker.localeCompare(b.ticker))) {
    if(allocated.has(c.ticker)){c.reason='paper_position_recorded';continue;}
    const cost=c.ask!+c.fee!, remaining=cfg.dailyCap-spent, matchLeft=cfg.perBetCap-(matchSpend.get(c.match!+'|'+c.kickoff)??0);
    const budget=Math.min(remaining,matchLeft,kelly(c.probability!,cost,cfg.bankroll,cfg.kellyMultiplier),cfg.bankroll-spent);
    c.contracts=Math.max(0,Math.min(Math.floor(budget/cost),Math.floor(c.askSize!)));
    if (!c.contracts) {
      c.reason=remaining<cost?'daily_cap_reached':matchLeft<cost?'match_cap_reached':'budget_too_small'; continue;
    }
    c.stake=Math.round(c.contracts*cost*1e6)/1e6;
    spent+=c.stake; matchSpend.set(c.match!+'|'+c.kickoff,(matchSpend.get(c.match!+'|'+c.kickoff)??0)+c.stake);
    c.decision='paper_pick'; c.reason='edge_after_fees';
    c.risks=['The model is fitted to historical scores.', 'The quote and displayed depth can change.', 'A lineup announcement could change the estimate.'];
    c.cancelIf=['Kickoff has passed, the quote expires, or available depth falls.', 'Recomputed edge is below the configured threshold.'];
    for (const fire of c.rules.filter(r=>r.id==='R11')) c.cancelIf.push('Official lineup contradicts the recorded absence: '+fire.explanation);
  }
  return rows;
}
function synthetic(at:Date, m:Match):Quote[] {
  const event=SERIES+'-'+tradingDay(m.kickoff)+'TOLMON';
  return ['home','draw','away'].map((side,i)=>{
    const ask=[.27,.33,.44][i]!, label=[m.home,'Tie',m.away][i]!;
    return {event,ticker:event+'-'+['TOL','TIE','MON'][i],label,title:label+' wins the regulation outcome',
      status:'active',rules:'Synthetic regulation time contract including stoppage time.',updated:at.toISOString(),
      open:new Date(at.valueOf()-3600000).toISOString(),close:m.kickoff,bid:ask-.02,ask,last:ask-.01,volume:1500,askSize:100};
  });
}
export async function buildCard(mode:Mode, at=new Date(), learned?:{version:string;weights:Record<string,number>;trainedThrough?:string}|null,previous:Allocation[]=[]):Promise<EngineCard> {
  const cfg = await loadPaperConfig();
  let asOf = at;
  const replay = mode==='replay' ? replaySchema.parse(JSON.parse(await readFile('data/replay.json','utf8'))) : null;
  if (replay) asOf=new Date(replay.asOf);
  const marketSource=replay?.source ?? (mode==='live'?MARKETS_URL+'?series_ticker='+cfg.series+'&status=open':'Synthetic paper-market scenario');
  let quotes:Quote[]=[], matches:Match[]=[], footballSource='Unavailable', marketStatus='ok', footballStatus='ok';
  if (mode==='live') {
    try { quotes=await readMarkets(cfg.series); }
    catch { marketStatus='unavailable'; }
  }
  try {
    const football=await footballContext(asOf.toISOString(),mode==='live'?'live':'demo');
    matches=football.matches; footballSource=football.source;
  } catch { footballStatus='unavailable'; }
  if (replay) {
    const fit = matches.find(m=>clean(m.home)===clean(replay.match.home) && clean(m.away)===clean(replay.match.away));
    matches=[{...replay.match,aliasesHome:fit?.aliasesHome??[],aliasesAway:fit?.aliasesAway??[],
      lambdaHome:fit?.lambdaHome??null,lambdaAway:fit?.lambdaAway??null,rho:fit?.rho??0,ratingVersion:fit?.ratingVersion,trainedThrough:fit?.trainedThrough}];
    quotes=replay.markets.map(q=>({ticker:q.ticker,event:replay.eventTicker,label:q.label,title:q.label+' · '+replay.match.home+' vs '+replay.match.away,
      updated:q.asOf,open:replay.asOf,close:replay.match.kickoff,status:'active',rules:q.rules,bid:q.bid,ask:q.ask,last:null,askSize:null,volume:q.volume}));
  } else if (mode==='demo') {
    const rated=matches.find(m=>clean(m.home)==='toluca' && clean(m.away)==='monterrey');
    const m:Match={home:'Toluca',away:'Monterrey',kickoff:new Date(asOf.valueOf()+2*3600000).toISOString(),aliasesHome:[],aliasesAway:[],
      lambdaHome:rated?.lambdaHome??null,lambdaAway:rated?.lambdaAway??null,rho:rated?.rho??0,ratingVersion:rated?.ratingVersion,trainedThrough:rated?.trainedThrough,
      facts:{home:{},away:{altitudeAcclimated:false},highAltitude:true,source:'Synthetic venue and travel scenario',favorite:'home'}};
    quotes=synthetic(asOf,m); matches=[m];
  }
  let newsStatus = mode==='demo'?'synthetic scenario':'unconfigured';
  if (mode==='live' && process.env.ASTERISK_NEWS_FILE) {
    try {
      const evidence=await loadMatchEvidence(asOf.toISOString(),matches);
      newsStatus=evidence.length?'verified evidence':'no qualifying evidence';
      matches=matches.map(m=>{
        const report=evidence.find(r=>r.home===m.home && r.away===m.away && r.kickoff===m.kickoff);
        if (!report) return m;
        return {...m,newsFlags:report.flags,facts:{...m.facts,home:{...m.facts?.home,...report.homeFacts},
          away:{...m.facts?.away,...report.awayFacts},source:[m.facts?.source,report.source].filter(Boolean).join(' · '),favorite:'home' as const}};
      });
    } catch { newsStatus='unavailable'; }
  }
  const eligibleWeights=mode==='live' && (!learned?.trainedThrough || Date.parse(learned.trainedThrough)<asOf.valueOf()) ? learned : null;
  const markets=evaluateQuotes(quotes,matches,asOf,cfg,marketSource,eligibleWeights?.weights,previous);
  if (replay) for (const c of markets) c.source=replay.markets.find(q=>q.ticker===c.ticker)!.source;
  const partial=footballStatus!=='ok' || markets.some(c=>c.probability===null || c.model===null);
  return {asOf:asOf.toISOString(),mode,source:marketSource,footballSource,modelVersion:'dc-logodds-v1',
    status:marketStatus!=='ok'?'unavailable':!markets.length?'empty':partial?'partial':'ready',
    providers:{market:marketStatus,football:footballStatus,news:newsStatus},
    markets,marketWeight:cfg.marketWeight,weightVersion:eligibleWeights?.version??'catalog-v1',bankroll:cfg.bankroll,dailyCap:cfg.dailyCap,exposure:markets.reduce((s,c)=>s+c.stake,previous.reduce((s,p)=>s+(p.today?p.stake:0),0)),tradingEnabled:false,
    simulation:mode==='demo',disclaimer:'Paper analysis only. This is not financial advice.'};
}
export function markdownCard(card:EngineCard) {
  const pct=(v:number|null)=>v===null?'—':(v*100).toFixed(1)+'%';
  const text=(s:string)=>s.replace(/[\r\n|]/g,' ').replace(/[<>]/g,'');
  const lines=['# Liga MX paper card', '',card.asOf+' UTC · '+card.mode+' · '+card.status,'',
    'Market source: '+text(card.source), 'Football: '+text(card.footballSource), 'Model: '+card.modelVersion,''];
  if (!card.markets.length) lines.push(card.status==='unavailable'?'Market feed unavailable.':'No open contracts in this series.','');
  for (const c of card.markets) {
    lines.push('## '+text(c.label)+' — '+text(c.match??c.ticker),'',
      c.kickoff?new Date(c.kickoff).toLocaleString('en-US',{timeZone:'America/Mexico_City'})+' Mexico City · '+new Date(c.kickoff).toLocaleString('en-US',{timeZone:'America/Chicago'})+' Chicago':'Unlinked fixture',
      '', 'Ask '+pct(c.ask)+' · Prior '+pct(c.prior)+' · Model '+pct(c.model)+' · Combined '+pct(c.probability)+' · Net edge '+pct(c.edge),
      '',c.decision+' · '+c.reason+' · Paper cost $'+c.stake.toFixed(2),'',...c.rules.map(f=>text(f.id+' '+f.explanation+' ['+f.source+']')),
      ...c.uncertainty.map(text),...c.risks.map(r=>'Risk: '+text(r)),...c.cancelIf.map(r=>'Cancel if: '+text(r)),'Source: '+text(c.source),'');
  }
  lines.push('Paper bankroll $'+card.bankroll.toFixed(2)+' · Exposure $'+card.exposure.toFixed(2)+' / $'+card.dailyCap.toFixed(2),card.disclaimer);
  return lines.join('\n');
}
