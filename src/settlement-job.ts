import { randomUUID } from 'node:crypto';
import { readFinals } from './settle.js';
import type { Database } from './db.js';

const eventLimit = 25;
type Pending = {run_id:string; event:string};
type Market = {ticker:string; event:string; kickoff:string|null};

export async function settlePending(db:Database, read:typeof readFinals=readFinals) {
  // Limit events in SQL. An event stays eligible if any sibling is unsettled.
  const due=await db.rows<Pending>(`SELECT p.run_id, p.observation->>'event' AS event
    FROM predictions p JOIN runs r ON r.id=p.run_id
    LEFT JOIN settlements s ON s.run_id=p.run_id AND s.ticker=p.ticker
    LEFT JOIN settlement_checks c ON c.run_id=p.run_id AND c.event=p.observation->>'event'
    WHERE r.mode='live' AND (s.ticker IS NULL OR c.run_id IS NOT NULL) AND p.observation->>'event' IS NOT NULL
      AND (p.observation->>'kickoff')::timestamptz<now()
      AND (c.next_check_at IS NULL OR c.next_check_at<=now())
    GROUP BY p.run_id, p.observation->>'event', c.next_check_at, r.run_day
    ORDER BY COALESCE(c.next_check_at,r.run_day::timestamptz), p.run_id, event
    LIMIT $1`,[eventLimit]);
  let added=0;
  for (const {run_id,event} of due) {
    const lease=randomUUID();
    const params=[run_id,event,lease];
    const claim=await db.rows(`INSERT INTO settlement_checks(run_id,event,attempts,next_check_at,lease,reason)
      VALUES($1,$2,1,now()+interval '2 minutes',$3,'checking')
      ON CONFLICT(run_id,event) DO UPDATE SET attempts=settlement_checks.attempts+1,
        next_check_at=EXCLUDED.next_check_at,lease=EXCLUDED.lease,reason='checking'
      WHERE settlement_checks.next_check_at<=now() RETURNING attempts`,params);
    if (!claim.length) continue;
    const group=await db.rows<Market>(`SELECT ticker, observation->>'event' AS event,observation->>'kickoff' AS kickoff
      FROM predictions WHERE run_id=$1 AND observation->>'event'=$2 ORDER BY ticker`,[run_id,event]);
    let reason='awaiting_complete_finals';
    try {
      const finals=await read(group);
      const ids=new Set(finals.map(f=>f.ticker));
      const complete=group.length===3 && finals.length===3 && ids.size===3 && group.every(m=>ids.has(m.ticker));
      if (complete) {
        const retryClosing=finals.some(f=>f.closingNote==='price_history_unavailable');
        added+=await db.transaction(async tx=>{
          const held=await tx.rows('SELECT lease FROM settlement_checks WHERE run_id=$1 AND event=$2 AND lease=$3 FOR UPDATE',params);
          if (!held.length) return 0;
          let inserted=0;
          for (const f of finals) {
            const result=await tx.rows(`INSERT INTO settlements(run_id,ticker,outcome,close_prior,source,settled_at)
              VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING ticker`,
              [run_id,f.ticker,f.outcome,null,f.source,f.settledAt]);
            inserted+=result.length;
            if(f.closingPrior!==null && f.closingEvidence) {
              await tx.rows(`INSERT INTO closing_observations(run_id,ticker,close_prior,candle_end_at,quotes)
                VALUES($1,$2,$3,to_timestamp($4),$5::jsonb) ON CONFLICT DO NOTHING`,
                [run_id,f.ticker,f.closingPrior,f.closingEvidence.endPeriodTs,JSON.stringify(f.closingEvidence.quotes)]);
            }
          }
          if (retryClosing) await tx.rows(`UPDATE settlement_checks SET reason='price_history_unavailable',
            next_check_at=now()+LEAST(interval '1 day',interval '15 minutes'*power(2,LEAST(attempts-1,7)))
            WHERE run_id=$1 AND event=$2 AND lease=$3`,params);
          else await tx.rows('DELETE FROM settlement_checks WHERE run_id=$1 AND event=$2 AND lease=$3',params);
          return inserted;
        });
        continue;
      }
    } catch {
      reason='settlement_read_failed';
    }
    await db.rows(`UPDATE settlement_checks SET reason=$4,
      next_check_at=now()+LEAST(interval '1 day',interval '15 minutes'*power(2,LEAST(attempts-1,7)))
      WHERE run_id=$1 AND event=$2 AND lease=$3`,[...params,reason]);
  }
  return added;
}
