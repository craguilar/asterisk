import {describe,it,expect,vi} from 'vitest';
import {verifyMatchNews,loadNewsReport} from '../src/news.js';

const game={home:'Toluca',away:'Monterrey',kickoff:'2026-04-11T22:00:00Z'};
const cutoff='2026-04-11T21:59:00Z', observed='2026-04-11T21:30:00Z';
const list=Array.from({length:11},(_,i)=>i===0?'Ana Gómez':'Player '+i);
const quote='Ana Gómez es baja por lesión.';
const rotation='Toluca will rotate the starting lineup.';
const articles=[{url:'https://tolucafc.com/update',language:'es',team:'Toluca',publishedAt:'2026-04-11T20:00:00Z',
  text:quote+' '+rotation,claims:[{type:'player_out',value:'Ana Gómez',confidence:'high',quote},{type:'rotation_risk',value:'high',confidence:'high',quote:rotation}]}];
const options={officialDomains:{Toluca:['tolucafc.com']},stars:{Toluca:['Ana Gómez']}};
const sheet=(starters:string[])=>({team:'Toluca',starters,publishedAt:observed,url:'https://tolucafc.com/xi'});
const source='https://site.api.espn.com/apis/site/v2/sports/soccer/mex.1/summary?event=72581';
const current={source,asOf:observed,currentLineups:{source,status:'available',observedAt:observed,teams:[{team:'Toluca',status:'confirmed',starters:list}]}};
const news=(lineups:unknown[],context?:typeof current)=>verifyMatchNews({...game,articles,lineups},cutoff,options,undefined,context);
describe('verified lineup evidence',()=>{
  it('keeps an unrelated absence and rotation active for a partial or duplicate XI',async()=>{
    for(const names of [['Other player'],Array(11).fill('Other player')]){
      const result=await news([sheet(names)]);
      expect(result.homeFacts).toMatchObject({confirmedStarOut:'Ana Gómez',rotationHigh:true});
    }
    const named=await news([sheet(['Ana Gomez'])]);
    expect(named.flags.find(f=>f.type==='player_out')?.status).toBe('superseded');
    expect(named.homeFacts.rotationHigh).toBe(true);
    const full=await news([sheet(list.map(n=>n==='Ana Gómez'?'Other starter':n))]);
    expect(full.homeFacts.confirmedStarOut).toBe('Ana Gómez');
    expect(full.homeFacts.rotationHigh).toBeUndefined();
  });
  it('uses confirmed pre-kickoff sheets from the authenticated fixture summary and preserves provenance',async()=>{
    const good=await news([],current);
    expect(good.homeFacts).toEqual({});
    expect(good.flags.every(f=>f.status==='superseded')).toBe(true);
    expect(good.officialLineups).toContainEqual({team:'Toluca',starters:list,url:source,publishedAt:observed});
    for(const changed of [
      {...current,currentLineups:{...current.currentLineups,status:'unavailable'}},
      {...current,source:source.replace('72581','4898123')},
      {...current,currentLineups:{...current.currentLineups,teams:[{team:'Toluca',status:'reported_unconfirmed',starters:list}]}},
      {...current,source:source.replace('site.api.espn.com','example.com'),currentLineups:{...current.currentLineups,source:source.replace('site.api.espn.com','example.com')}},
      {...current,currentLineups:{...current.currentLineups,observedAt:'2026-04-11T22:10:00Z'}},
    ]){
      expect((await news([],changed)).homeFacts).toMatchObject({confirmedStarOut:'Ana Gómez',rotationHigh:true});
    }
  });
});

it('retains the authenticated XI on a normal news report when no local corpus or RSS article exists',async()=>{
  vi.stubEnv('ASTERISK_NEWS_FILE','');vi.stubEnv('ASTERISK_NEWS_FEEDS','');
  try{
    const report=await loadNewsReport(cutoff,[{...game,matchContext:current}]);
    expect(report.status).toContain('confirmed lineup only');
    expect(report.evidence[0].officialLineups[0]).toMatchObject({team:'Toluca',url:source,starters:list});
  }finally{vi.unstubAllEnvs();}
});
