import { describe, it, expect } from 'vitest';
import { parseGoalClock, scheduleContext, summaryFacts, tableContext } from '../src/football-details.js';
import type { FootballEvent } from '../src/football.js';
const make = (id:string,date:string,h:string,a:string,state='pre'):FootballEvent => ({id,date,season:{year:2026,slug:'torneo-apertura'},
  competitions:[{competitors:[{homeAway:'home',team:{displayName:h},score:'2'},{homeAway:'away',team:{displayName:a},score:'1'}],
    status:{period:2,type:{state,name:state==='pre'?'STATUS_SCHEDULED':'STATUS_FULL_TIME'}}}]});
describe('source-backed Liga MX match context',()=>{
  it('keeps stoppage goals within the correct regulation or extra-time period',()=>{
    expect(parseGoalClock("90'+4'",2)).toEqual({minute:90,addedMinute:4,period:2,regulation:true});
    expect(parseGoalClock("105'+2'",3)?.regulation).toBe(false);
    expect(parseGoalClock("45'",1)?.minute).toBe(45);
    expect(parseGoalClock("PEN",5)).toBeNull();
  });
  it('rejects a summary for a different fixture and keeps projected lineups unconfirmed',()=>{
    const roster=Array.from({length:11},(_,i)=>({starter:true,athlete:{displayName:'Player '+i}}));
    const raw={header:{id:'1',competitions:[{status:{type:{state:'pre'}}}]},rosters:[{team:{displayName:'Toluca'},roster}]};
    expect(()=>summaryFacts(raw,'2','2026-01-01T00:00Z')).toThrow(/identity/);
    expect(summaryFacts(raw,'1','2026-01-01T00:00Z').lineups[0].status).toBe('reported_unconfirmed');
  });
  it('reports the preceding and next league fixture even when teams are home and away',()=>{
    const target=make('1','2026-10-10T00:00Z','A','B');
    const prev=make('2','2026-10-05T00:00Z','C','A','post'), next=make('3','2026-10-14T00:00Z','D','A');
    expect(scheduleContext([target,prev,next],target,'A',Date.parse('2026-10-09'))).toMatchObject({daysSincePrevious:5,daysUntilNext:4});
  });
  it('only awards regular-season points for results known before the cutoff',()=>{
    const target=make('100','2026-10-20T00:00Z','A','B');
    const fixtures=[target,make('1','2026-10-01T01:00Z','A','B','post'),make('2','2026-10-18T01:00Z','B','A','post'),
      ...Array.from({length:8},(_,i)=>make(String(10+i),'2026-10-20T12:00Z','C'+(2*i),'C'+(2*i+1)))];
    expect(tableContext(fixtures,target,'A',Date.parse('2026-10-10'))).toMatchObject({points:3,played:1,rank:1,clinchedTopSix:false});
    expect(tableContext(fixtures,target,'B',Date.parse('2026-10-10'))?.points).toBe(0);
  });
});
