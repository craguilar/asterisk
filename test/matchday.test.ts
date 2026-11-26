import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {database} from '../src/db.js';
import {paperMatchday} from '../src/matchday.js';

it('traces only prospective live forecasts on the local match date through official settlement',async()=>{
  const path=await mkdtemp(join(tmpdir(),'asterisk-day-')),db=await database(undefined,path);
  try{
    await db.migrate();
    await db.transaction(async tx=>{
      const [start]=await tx.rows('SELECT now() AS start');
      const id=randomUUID();
      await tx.rows("INSERT INTO runs(id,mode,run_day,card) VALUES($1,'live',current_date,'{}'::jsonb)",[id]);
      const cutoff=new Date(new Date(start.start).valueOf()+25);
      await new Promise(resolve=>setTimeout(resolve,80));
      const [publication]=await tx.rows('INSERT INTO run_publications(run_id) VALUES($1) RETURNING recorded_at',[id]);
      expect(new Date(publication.recorded_at).valueOf()).toBeGreaterThan(cutoff.valueOf());
    });
    const date='2026-11-26',kickoff='2026-11-27T01:00:00.000Z',pre='2026-11-26T18:00:00Z',late='2026-11-27T02:00:00Z';
    const match={home:'Pachuca',away:'Guadalajara',kickoff};
    for(const [mode,when] of [['replay',pre],['live',late],['live',pre]]){
      const id=randomUUID();
      await db.rows('INSERT INTO runs(id,mode,run_day,attempted_at,card) VALUES($1,$2,$3,$4,$5::jsonb)',[id,mode,date,pre,JSON.stringify({asOf:pre})]);
      await db.rows('INSERT INTO domain_runs(run_id,forecast_at,results_coverage) VALUES($1,$2,$3)',[id,pre,'fixture']);
      await db.rows('INSERT INTO domain_evidence VALUES($1,$2,$3,$4::jsonb)',[id,'matches','fixture',JSON.stringify(match)]);
      await db.rows('INSERT INTO run_publications VALUES($1,$2)',[id,when]);
      for(const ticker of ['HOME','TIE','AWAY']){
        await db.rows('INSERT INTO predictions VALUES($1,$2,$3::jsonb)',[id,ticker,JSON.stringify({kickoff,match:'Pachuca vs Guadalajara',probability:.33,ask:.35,reason:'no_edge',decision:'no_bet'})]);
      }
      if(mode==='replay'||when===late){expect((await paperMatchday(db,date)).status).toBe('no_recorded_fixtures');continue;}
      const report=await paperMatchday(db,date);
      expect(report.status).toBe('awaiting_official_result');
      expect(report.matches[0].observations.map(p=>p.runId)).toEqual([id,id,id]);
      for(const ticker of ['HOME','TIE','AWAY'])await db.rows('INSERT INTO settlements VALUES($1,$2,$3,NULL,$4,$5)',[id,ticker,ticker==='AWAY'?1:0,'official',late]);
      expect((await paperMatchday(db,date)).status).toBe('settled');
      expect((await paperMatchday(db,'2026-11-27')).matches).toEqual([]);
    }
  }finally{await db.close();await rm(path,{recursive:true,force:true});}
},60000);
