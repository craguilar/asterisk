import {createHash} from 'node:crypto';
import type {Sql} from './db.js';
import type {Ratings,Result} from './football.js';
import type {EngineCard,Match} from './pipeline.js';

export interface DomainInputs {
  ratings:Ratings|null; results:Result[]; matches:Match[]; coverage:string;
}
const datasets=['matches','goals','lineups','flags','availability','sources'] as const;
type Dataset=typeof datasets[number];
interface Evidence { dataset:Dataset;identity:string;record:object }

export async function persistDomain(sql:Sql,runId:string,card:EngineCard,inputs:DomainInputs) {
  const {ratings,results,matches}=inputs;
  if(ratings){
    if(Date.parse(ratings.asOf)>Date.parse(card.asOf) || (ratings.trainedThrough && !(Date.parse(ratings.trainedThrough)<Date.parse(ratings.asOf))))
      throw Error('Rating snapshot exceeds forecast cutoff');
    const {version,asOf,trainedThrough,samples,...parameters}=ratings;
    await sql.rows('INSERT INTO domain_ratings VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING',[version,JSON.stringify(parameters)]);
  }
  await sql.rows('INSERT INTO domain_runs VALUES($1,$2,$3,$4,$5,$6,$7)',
    [runId,card.asOf,ratings?.version??null,ratings?.asOf??null,ratings?.trainedThrough??null,ratings?.samples??null,inputs.coverage]);
  const available=results.filter(r=>r.availableAt<Date.parse(card.asOf));
  // A refresh references the same immutable corpus until a training observation changes.
  const records=[...new Set(available.map(row=>JSON.stringify(row)))].sort();
  const digest=createHash('sha256').update(JSON.stringify(records)).digest('hex');
  const created=await sql.rows('INSERT INTO domain_result_sets VALUES($1) ON CONFLICT DO NOTHING RETURNING digest',[digest]);
  if(created.length && records.length){
    const values='['+records.join(',')+']';
    await sql.rows('INSERT INTO domain_results(observation) SELECT DISTINCT value FROM jsonb_array_elements($1::jsonb) ORDER BY value ON CONFLICT DO NOTHING',[values]);
    await sql.rows(`INSERT INTO domain_set_results SELECT DISTINCT $1::text,r.id FROM jsonb_array_elements($2::jsonb) item JOIN domain_results r ON r.observation=item.value`,[digest,values]);
  }
  await sql.rows('INSERT INTO domain_run_sets VALUES($1,$2)',[runId,digest]);
  const all=new Map<string,Evidence>();
  const add=(dataset:Dataset,record:object)=>{
    const identity=createHash('sha256').update(JSON.stringify(record)).digest('hex');
    all.set(dataset+identity,{dataset,identity,record});
  };
  for(const [provider,status] of Object.entries(card.providers)) add('sources',{provider,status,asOf:card.asOf,
    source:provider==='market'?card.source:provider==='football'?card.footballSource:'Reviewed match news',mode:card.mode});
  for(const m of matches) {
    const {matchContext:ctx,newsFlags=[],officialLineups=[],...fixture}=m;
    const key={home:m.home,away:m.away,kickoff:m.kickoff};
    const {recentGames,currentLineups,...details}=ctx??{recentGames:[],currentLineups:null};
    add('matches',{...fixture,...details,source:ctx?.source??card.footballSource,asOf:card.asOf});
    for(const previous of recentGames){
      add('sources',{provider:'previous_match',id:previous.id,source:previous.source,asOf:previous.observedAt,status:previous.status});
      for(const [ordinal,goal] of previous.goals.entries())add('goals',{gameId:previous.id,ordinal,...goal,source:previous.source,observedAt:previous.observedAt});
      for(const l of previous.lineups)add('lineups',{gameId:previous.id,...l,source:previous.source,observedAt:previous.observedAt});
    }
    if(currentLineups) {
      add('sources',{provider:'fixture_lineup',...key,source:currentLineups.source,asOf:currentLineups.observedAt,status:currentLineups.status});
      for(const l of currentLineups.teams)add('lineups',{...key,...l,source:currentLineups.source,observedAt:currentLineups.observedAt});
    }
    for(const l of officialLineups) {
      if(![m.home,m.away].includes(l.team)||l.starters.length!==11 || new Set(l.starters).size!==11 ||
        !(Date.parse(l.publishedAt)<=Date.parse(card.asOf) && Date.parse(l.publishedAt)<Date.parse(m.kickoff)))continue;
      add('lineups',{...key,team:l.team,starters:l.starters,status:'confirmed',observedAt:l.publishedAt,source:l.url});
    }
    for(const flag of newsFlags){
      add('flags',{...key,...flag});
      if(flag.type.startsWith('player_')) add('availability',{...key,team:flag.team,player:flag.value,type:flag.type,status:flag.status,citations:flag.citations});
      for(const c of flag.citations)add('sources',{provider:'news',...key,source:c.url,asOf:c.publishedAt});
    }
  }
  await sql.rows(`INSERT INTO domain_evidence SELECT $1::uuid,x.dataset,x.identity,x.record
    FROM jsonb_to_recordset($2::jsonb) AS x(dataset text,identity text,record jsonb)`,[runId,JSON.stringify([...all.values()])]);
}

export async function loadRunDomain(sql:Sql,runId:string) {
  const [capture]=await sql.rows(`SELECT d.*,p.parameters FROM domain_runs d LEFT JOIN domain_ratings p USING(version) WHERE run_id=$1`,[runId]);
  if(!capture)return null;
  const iso=(v:string|Date|null)=>v?new Date(v).toISOString():null;
  const ratings=capture.parameters?{...capture.parameters,version:capture.version,asOf:iso(capture.fitted_as_of),
    trainedThrough:iso(capture.trained_through),samples:capture.sample_count}:null;
  const evidence=await sql.rows('SELECT dataset,record FROM domain_evidence WHERE run_id=$1 ORDER BY dataset,identity',[runId]);
  const dataset=(name:Dataset)=>evidence.filter(e=>e.dataset===name).map(e=>e.record);
  const results=await sql.rows(`SELECT r.observation FROM domain_results r JOIN (
    SELECT result_id FROM domain_run_sets a JOIN domain_set_results b USING(digest) WHERE a.run_id=$1
    UNION SELECT result_id FROM domain_run_results WHERE run_id=$1
  ) members ON members.result_id=r.id ORDER BY r.observation`,[runId]);
  return {runId,asOf:iso(capture.forecast_at),ratings,resultsCoverage:capture.results_coverage,results:results.map(r=>r.observation),
    matches:dataset('matches'),goals:dataset('goals'),lineups:dataset('lineups'),flags:dataset('flags'),availability:dataset('availability'),sources:dataset('sources'),
    priceSnapshots:await sql.rows('SELECT * FROM domain_price_snapshots WHERE run_id=$1 ORDER BY ticker',[runId]),
    decisions:await sql.rows('SELECT * FROM domain_decisions WHERE run_id=$1 ORDER BY ticker',[runId])};
}
