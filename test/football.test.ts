import { describe, expect, it } from 'vitest';
import { espnResults, extendArchive, fit, footballContext, forecast, history, scoreboard } from '../src/football.js';

const events = (teams=['Toluca','Monterrey'], state='STATUS_FULL_TIME', period=2) => [{
  id:'example',date:'2026-11-08T01:00Z',competitions:[{competitors:teams.map((name,i)=>({
    homeAway:i ? 'away':'home', team:{displayName:name,abbreviation:i?'MTY':'TOL'},score:i?'1':'2'
  })),status:{type:{name:state,state:state==='STATUS_SCHEDULED'?'pre':'post'},period}}]}];
describe('football data and model',()=>{
  it('separates regulation goals and excludes shootout and extra-time totals from the public feed',()=>{
    expect(espnResults(events())[0]).toMatchObject({hg:2,ag:1});
    expect(espnResults(events(undefined,'STATUS_FINAL_PEN',5))).toEqual([]);
    expect(espnResults(events(undefined,'STATUS_FULL_TIME',4))).toEqual([]);
  });
  it('excludes the cutoff itself and every outcome after the forecast',()=>{
    const base=history(),cutoff='2024-06-01T00:00:00Z';
    const time=Date.parse(cutoff);
    const model=fit(base,cutoff);
    const future={...base[0],availableAt:time,home:'Future FC',hg:20};
    expect(fit([...base,future,{...future,availableAt:time+1}],cutoff)).toEqual(model);
    expect(forecast(model,'Future FC','Toluca').lambdaHome).toBeNull();
    expect(new Date(model.trainedThrough!).valueOf()).toBeLessThan(time);
  });
  it('uses at least five observations for each team',()=>{
    const records=espnResults(events());
    const data=Array.from({length:4},(_,i)=>({...records[0],availableAt:records[0].availableAt+i}));
    expect(forecast(fit(data,'2027-01-01T00:00:00Z'),'Toluca','Monterrey').lambdaHome).toBeNull();
  });
  it('deduplicates overlapping annual feeds',()=>{
    const e=events();
    expect(extendArchive(history(),[...e,...e])).toHaveLength(history().length+1);
  });
  it('loads the real archived replay without network and records its exact kickoff',async()=>{
    const c=await footballContext('2026-11-07T16:00:00.000Z','demo',async()=>{throw Error('unexpected network');});
    expect(c.matches[0]).toMatchObject({home:'Toluca',away:'Monterrey',kickoff:'2026-11-08T01:00:00.000Z'});
    expect(c.matches[0].lambdaHome).toBeGreaterThan(0);
    expect(c.matches[0].trainedThrough! < '2026-11-07').toBe(true);
  });
  it('returns matched future ESPN fixtures and surfaces upstream outages', async()=>{
    const read:typeof fetch=async()=>Response.json({events:events(undefined,'STATUS_SCHEDULED')});
    const c=await footballContext('2026-11-07T15:00:00Z','live',read);
    expect(c.matches).toHaveLength(1);
    expect(c.matches[0].aliasesAway).toContain('MTY');
    await expect(scoreboard('2026',async()=>Response.json({},{status:503}))).rejects.toThrow('503');
  });
});
