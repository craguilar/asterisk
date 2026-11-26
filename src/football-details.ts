import { teamName, espnResults, formWeight, type FootballEvent, type Ratings, type Result } from './football.js';

const DAY = 86_400_000;
const SUMMARY = 'https://site.api.espn.com/apis/site/v2/sports/soccer/mex.1/summary';
function teams(event: FootballEvent) {
  return event.competitions[0]?.competitors?.map(c=>teamName(c.team.displayName)) ?? [];
}
export function scheduleContext(events: FootballEvent[], event: FootballEvent, team: string, asOf: number) {
  const kickoff = Date.parse(event.date);
  const relevant = events.filter(e => e.id !== event.id && teams(e).includes(team));
  const previous = relevant.filter(e => Date.parse(e.date)<asOf && e.competitions[0]?.status?.type?.state==='post')
    .sort((a,b)=>Date.parse(b.date)-Date.parse(a.date))[0];
  const next = relevant.filter(e => Date.parse(e.date)>kickoff && e.competitions[0]?.status?.type?.state==='pre')
    .sort((a,b)=>Date.parse(a.date)-Date.parse(b.date))[0];
  return {competition:'Liga MX',previousKickoff:previous?.date??null,nextKickoff:next?.date??null,
    daysSincePrevious:previous?(kickoff-Date.parse(previous.date))/DAY:null,daysUntilNext:next?(Date.parse(next.date)-kickoff)/DAY:null};
}

export function tableContext(events: FootballEvent[], event: FootballEvent, team: string, asOf: number) {
  const season=event.season;
  if (!season || !['torneo-apertura','torneo-clausura'].includes(season.slug)) return null;
  const same=events.filter(e=>e.season?.year===season.year && e.season?.slug===season.slug);
  const table=new Map<string,{team:string;points:number;gf:number;ga:number;played:number}>();
  for(const id of new Set(same.flatMap(teams))) table.set(id,{team:id,points:0,gf:0,ga:0,played:0});
  for (const r of espnResults(same)) {
    if(r.availableAt>=asOf)continue;
    const h=table.get(r.home)!,a=table.get(r.away)!;
    h.played++;a.played++;h.gf+=r.hg;h.ga+=r.ag;a.gf+=r.ag;a.ga+=r.hg;
    h.points+=r.hg>r.ag?3:Number(r.hg===r.ag);a.points+=r.ag>r.hg?3:Number(r.hg===r.ag);
  }
  const row=table.get(team);
  if(!row || table.size!==18 || [...table.values()].some(t=>t.played>17)) return null;
  const others=[...table.values()].filter(t=>t.team!==team);
  const ranked=[...table.values()].sort((a,b)=>b.points-a.points || (b.gf-b.ga)-(a.gf-a.ga) || b.gf-a.gf);
  const index=ranked.indexOf(row),tie=others.some(t=>t.points===row.points && t.gf-t.ga===row.gf-row.ga && t.gf===row.gf);
  return {season:season.slug,points:row.points,played:row.played,rank:tie?null:index+1,
    pointsBehindFirst:ranked[0].points-row.points,pointsAheadOfSeventh:row.points-ranked[6].points,
    // Conservative bounds, with ties counted against the team. Competition rules beyond finishing top six vary by tournament.
    clinchedTopSix:others.filter(t=>t.points+3*(17-t.played)>=row.points).length<=5,
    topSixImpossible:others.filter(t=>t.points>row.points+3*(17-row.played)).length>=6};
}

type RawSummary={
  header?:{id?:string;competitions?:Array<{status?:{type?:{state?:string}}}>};
  keyEvents?:Array<{scoringPlay?:boolean;shootout?:boolean;period?:{number?:number};clock?:{displayValue?:string};
    team?:{displayName?:string};type?:{type?:string};penaltyKick?:boolean;text?:string}>;
  rosters?:Array<{homeAway?:string;team?:{displayName?:string};confirmed?:boolean;
    roster?:Array<{starter?:boolean;athlete?:{displayName?:string}}>}>
};
export function parseGoalClock(display:string,period:number) {
  const m=/^(\d{1,3})(?:'|’)?\s*(?:\+\s*(\d{1,2}))?(?:'|’)?$/.exec(display.trim());
  if(!m || !Number.isInteger(period) || period<1 || period>4) return null;
  const minute=Number(m[1]),addedMinute=Number(m[2]??0);
  return {minute,addedMinute,period,regulation:period<=2};
}
export function summaryFacts(raw: RawSummary, expectedId: string, asOf: string) {
  if(raw.header?.id!==expectedId) throw Error('ESPN summary identity mismatch');
  const state=raw.header?.competitions?.[0]?.status?.type?.state;
  const goals=(raw.keyEvents??[]).flatMap(e=>{
    if(!e.scoringPlay || e.shootout || !e.team?.displayName) return [];
    const clock=parseGoalClock(e.clock?.displayValue??'',e.period?.number??0);
    if(!clock)return [];
    const evidence=e.text?.toLowerCase()??'';
    const kind=e.penaltyKick===true || /penalty|spot kick/.test(evidence)?'penalty':
      /following a corner|following a set piece|free kick/.test(evidence)?'set_piece':'unspecified';
    return [{team:teamName(e.team.displayName),...clock,kind}];
  });
  const lineups=(raw.rosters??[]).flatMap(r=>{
    const starters=[...new Set((r.roster??[]).filter(p=>p.starter).map(p=>p.athlete?.displayName).filter((s):s is string=>!!s))];
    if(!r.team?.displayName || starters.length!==11)return [];
    return [{team:teamName(r.team.displayName),starters,status:state==='post'?'observed_after_match':
      r.confirmed===true?'confirmed':'reported_unconfirmed'}];
  });
  return {source:SUMMARY+'?event='+expectedId,observedAt:asOf,goals,lineups};
}
export async function readSummary(id:string, observedAt:string, fetchImpl:typeof fetch) {
  if(!/^\d{1,15}$/.test(id))throw Error('Invalid ESPN event id');
  const response=await fetchImpl(SUMMARY+'?event='+id,{signal:AbortSignal.timeout(4000),redirect:'error'});
  if(!response.ok)throw Error('ESPN match summary unavailable');
  return summaryFacts(await response.json(),id,observedAt);
}

function form(team:string, results:Result[], asOf:number) {
  const recent=results.filter(g=> (g.home===team || g.away===team) && g.availableAt<asOf)
    .sort((a,b)=>b.availableAt-a.availableAt).slice(0,5);
  if(recent.length!==5)return {};
  const total=recent.reduce((s,g)=>s+formWeight(g),0);
  const goals=recent.reduce((s,g)=>s+formWeight(g)*(g.hg+g.ag),0);
  return {bigWinDistorted:recent.some(g=>formWeight(g)<1 && (g.distortedWin==='home'?g.home:g.away)===team),
    frequentDraws:recent.filter(g=>g.hg===g.ag).length>=2,lowEvent:goals/total<=2,
    scoresRecently:recent.reduce((s,g)=>s+formWeight(g)*Number((g.home===team?g.hg:g.ag)>0),0)>total/2};
}

export async function matchDetail(home:string,away:string,e:FootballEvent,events:FootballEvent[],results:Result[],
  model:Ratings,asOf:string,fetchImpl:typeof fetch) {
  const time=Date.parse(asOf),stage=e.season?.slug??null;
  const standings={home:tableContext(events,e,home,time),away:tableContext(events,e,away,time)};
  const schedule={home:scheduleContext(events,e,home,time),away:scheduleContext(events,e,away,time)};
  const previous=events.filter(p=>p.competitions[0]?.status?.type?.state==='post' && Date.parse(p.date)+DAY<time &&
    (teams(p).includes(home)||teams(p).includes(away))).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
  const ids=[...new Set([e.id,...[home,away].map(t=>previous.find(p=>teams(p).includes(t))?.id).filter((s):s is string=>!!s)])];
  const evidence=await Promise.all(ids.map(async id=>{
    try { return {id, ...await readSummary(id,asOf,fetchImpl),status:'available' as const}; }
    catch {return {id,source:SUMMARY+'?event='+id,observedAt:asOf,status:'unavailable' as const,goals:[],lineups:[]};}
  }));
  // The current fixture is pre-match. A summary can race with the scoreboard at kickoff.
  // Do not include scores or a retrospectively confirmed team sheet from that fixture.
  const current=evidence.find(x=>x.id===e.id)!;
  const previousMatches=evidence.filter(x=>x.id!==e.id);
  const facts={home:{...form(home,results,time),qualified:standings.home?.clinchedTopSix},
    away:{...form(away,results,time),qualified:standings.away?.clinchedTopSix},
    source:'ESPN pre-match results and tournament table, as of '+asOf,favorite:'home' as const,
    knockout:stage===null?undefined:/quarterfinal|semifinal|finals|play-in|seed|place-vs/.test(stage),
    lateStage:stage===null?undefined:/semifinal|(?<!quarter)---finals/.test(stage)};
  return {facts,matchContext:{venue:e.competitions[0].venue?.fullName??null,stage,source:SUMMARY+'?event='+e.id,
    asOf,schedule,standings,ratingVersion:model.version,recentGames:previousMatches,
    currentLineups:{status:current.status,observedAt:asOf,source:current.source,teams:current.lineups.filter(l=>l.status!=='observed_after_match')}}};
}
