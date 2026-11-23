import type {Sql,Database} from './db.js';
import type {EngineCard} from './pipeline.js';
import {learnWeights,ruleAttribution,type TrainingExample,type WeightVersion} from './learning.js';

async function examples(sql:Sql,mode:string,throughDay?:string):Promise<TrainingExample[]>{
  const rows=await sql.rows(`WITH final AS (
     SELECT DISTINCT ON(s.ticker) s.ticker,s.outcome,s.settled_at
     FROM settlements s JOIN runs r ON r.id=s.run_id
     WHERE r.mode=$1 ORDER BY s.ticker,s.settled_at,s.run_id)
    SELECT r.card,jsonb_object_agg(p.ticker,jsonb_build_object('outcome',f.outcome,'settledAt',f.settled_at)) AS outcomes
    FROM runs r JOIN predictions p ON p.run_id=r.id JOIN final f ON f.ticker=p.ticker
    WHERE r.mode=$1 AND ($2::date IS NULL OR r.run_day<=$2::date)
    GROUP BY r.id ORDER BY r.run_day,r.attempted_at,r.id`,[mode,throughDay??null]);
  return rows.map(r=>({card:r.card as EngineCard,outcomes:r.outcomes}));
}
export async function latestWeights(sql:Sql):Promise<WeightVersion|null>{
  const [r]=await sql.rows('SELECT model FROM weight_versions ORDER BY seq DESC LIMIT 1');
  return r?.model??null;
}
export async function refreshWeights(db:Database){
  return db.transaction(async tx=>{
    await tx.rows('SELECT pg_advisory_xact_lock(725152)');
    const next=learnWeights(await examples(tx,'live'),await latestWeights(tx));
    if(next)await tx.rows('INSERT INTO weight_versions(version,model) VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING',[next.version,JSON.stringify(next)]);
    return next?.version??null;
  });
}
export async function attribution(sql:Sql,mode:string,range:{from?:string;to?:string}={}){
  const rows=await examples(sql,mode,range.to);
  return ruleAttribution(rows,range);
}
