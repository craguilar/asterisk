import {z} from 'zod';
import type {Sql} from './db.js';

// Use the match's local calendar date and the database's actual recording time.
// A replay, a late import, or an out-of-window price cannot qualify as forward evidence.
export async function paperMatchday(sql:Sql, date:string) {
  z.iso.date().parse(date);
  const fixtures=await sql.rows(`SELECT DISTINCT e.record->>'home' AS home,e.record->>'away' AS away,e.record->>'kickoff' AS kickoff
    FROM domain_evidence e JOIN runs r ON r.id=e.run_id JOIN run_publications pub ON pub.run_id=r.id
    WHERE r.mode='live' AND e.dataset='matches'
    AND ((e.record->>'kickoff')::timestamptz AT TIME ZONE 'America/Mexico_City')::date=$1::date
    AND pub.recorded_at < (e.record->>'kickoff')::timestamptz
    ORDER BY kickoff,home,away`,[date]);
  const forecasts=await sql.rows(`SELECT DISTINCT ON (p.ticker) p.ticker,r.id AS "runId",r.card->>'asOf' AS "asOf",pub.recorded_at AS "recordedAt",
     p.observation->>'match' AS match,p.observation->>'kickoff' AS kickoff,p.observation->>'decision' AS decision,
     p.observation->>'source' AS source,p.observation->>'updated' AS "quoteObservedAt",r.card->>'modelVersion' AS "modelVersion",
     (p.observation->>'stake')::float8 AS "paperStake",p.observation->>'reason' AS reason,(p.observation->>'probability')::float8 AS probability,
     (p.observation->>'ask')::float8 AS ask,s.outcome,s.close_prior AS "closingPrior",s.source AS "settlementSource"
    FROM predictions p JOIN runs r ON r.id=p.run_id JOIN run_publications pub ON pub.run_id=r.id LEFT JOIN effective_settlements s ON s.run_id=p.run_id AND s.ticker=p.ticker
    WHERE r.mode='live' AND p.observation->>'probability' IS NOT NULL
    AND ((p.observation->>'kickoff')::timestamptz AT TIME ZONE 'America/Mexico_City')::date=$1::date
    AND (r.card->>'asOf')::timestamptz < (p.observation->>'kickoff')::timestamptz
    AND pub.recorded_at < (p.observation->>'kickoff')::timestamptz
    ORDER BY p.ticker,pub.recorded_at,r.id`,[date]);
  const matches=fixtures.map(f=>{
    const observations=forecasts.filter(p=>p.match===f.home+' vs '+f.away && p.kickoff===f.kickoff);
    const status=observations.length!==3?'coverage_incomplete':observations.every(p=>p.outcome!==null)?'settled':'awaiting_official_result';
    return {...f,status,observations};
  });
  const status=!matches.length?'no_recorded_fixtures':matches.some(m=>m.status==='coverage_incomplete')?'coverage_incomplete':
    matches.every(m=>m.status==='settled')?'settled':'awaiting_official_result';
  return {date,timeZone:'America/Mexico_City',mode:'live',basis:'First pre-kickoff forecast per contract for fixtures observed before kickoff',status,matches};
}
