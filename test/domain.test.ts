import { it,expect,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { database } from '../src/db.js';
import { daily } from '../src/store.js';
import { loadRunDomain } from '../src/domain.js';
import { fit, forecast, history } from '../src/football.js';
import { evaluateRules, secondaryEstimates, type RuleFacts } from '../src/rules.js';
import { scoreGrid } from '../src/math.js';

it('reopens one full parameter snapshot and all datasets; paper decisions and price snapshots remain separate',async()=>{
  const path=await mkdtemp(join(tmpdir(),'asterisk-domain-'));
  let db=await database(undefined,path);
  try{
    await db.migrate();
    const run=await daily(db,'replay'); await db.close(); db=await database(undefined,path);
    const stored=await loadRunDomain(db,run.id);
    expect(stored.ratings.teams.Toluca.matches).toBeGreaterThan(5);
    expect(stored.ratings.version).toBe(run.card.markets[0].ratingVersion);
    expect(stored.ratings.asOf).toBe(run.card.asOf);
    expect(stored.matches).toHaveLength(1);expect(stored.decisions).toHaveLength(3);expect(stored.priceSnapshots).toHaveLength(3);
    expect(stored.results.length).toBeGreaterThan(100);expect(stored.sources.length).toBeGreaterThanOrEqual(2);
    expect(stored.flags).toEqual([]);expect(stored.goals).toEqual([]);expect(stored.lineups).toEqual([]);expect(stored.availability).toEqual([]);
    expect(JSON.stringify(run.card.markets)).not.toContain('"intercept"');
    expect(await loadRunDomain(db,randomUUID())).toBeNull();
  }finally{await db.close();await rm(path,{recursive:true,force:true});}
},60000);

it('discounts only the observed distorted historical blowout, preserving the regular sample count',()=>{
  const asOf='2024-06-01T00:00:00Z',games=history().filter(r=>r.availableAt<Date.parse(asOf));
  const i=games.findLastIndex(g=>g.hg-g.ag>=3);
  const baseline=fit(games,asOf),g=games[i];
  const changed=games.map((r,k)=>i===k?{...g,distortedWin:'home' as const}:r);
  const corrected=fit(changed,asOf);
  expect(corrected.samples).toBe(baseline.samples);
  expect(forecast(corrected,g.home,g.away).lambdaHome!).toBeLessThan(forecast(baseline,g.home,g.away).lambdaHome!);
  expect(fit(games.map((r,k)=>i===k?{...g,distortedWin:'away' as const}:r),asOf).version).toBe(baseline.version);
});
it('propagates scoring and BTTS evidence into unpriced diagnostics, without inventing a stake or contract',()=>{
  const f:RuleFacts={favorite:'home',home:{transitionLeaky:true},away:{scoresRecently:true},source:'verified fixture'};
  const grid=scoreGrid(1.6,1,0),r=secondaryEstimates(grid,evaluateRules(f),f);
  expect(r.btts.probability).toBeGreaterThan(grid.btts);expect(r.awayScores.probability).toBeGreaterThan(r.awayScores.baseline);
  expect(r.homeCleanSheet.probability+r.awayScores.probability).toBeCloseTo(1,12);
  expect(r.extraTime).toBeNull();expect(r.btts).not.toHaveProperty('stake');expect(r.btts).not.toHaveProperty('ticker');
});


it('persists a real fit and source status with zero exchange markets, without creating a fake prediction',async()=>{
  const path=await mkdtemp(join(tmpdir(),'asterisk-empty-domain-'));
  const db=await database(undefined,path);
  vi.stubGlobal('fetch',async(url:URL|string)=>{
    const u=new URL(String(url));
    if(u.pathname.endsWith('/markets'))return Response.json({markets:[],cursor:''});
    if(u.pathname.endsWith('/scoreboard'))return Response.json({events:[]});
    throw Error('Unexpected network path');
  });
  try{
    await db.migrate();
    const run=await daily(db,'live',new Date('2026-11-07T16:00:00Z'),true);
    const saved=await loadRunDomain(db,run.id);
    expect(run.card.status).toBe('empty');
    expect(saved?.ratings.teams.Toluca.matches).toBeGreaterThan(5);
    const next=await daily(db,'live',new Date('2026-11-07T16:01:00Z'),true);
    expect((await loadRunDomain(db,next.id))?.results).toEqual(saved?.results);
    expect(await db.rows('SELECT count(*)::int AS n FROM domain_run_sets')).toEqual([{n:2}]);
    expect(await db.rows('SELECT count(*)::int AS n FROM domain_result_sets')).toEqual([{n:1}]);
    expect(await db.rows('SELECT count(*)::int AS n FROM domain_set_results')).toEqual([{n:saved?.results.length}]);
    expect(saved?.matches).toEqual([]);expect(saved?.decisions).toEqual([]);
    expect(saved?.sources).toContainEqual(expect.objectContaining({provider:'market',status:'ok'}));
  } finally {vi.unstubAllGlobals();await db.close();await rm(path,{recursive:true,force:true});}
},60000);
