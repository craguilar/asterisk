import { expect,it } from 'vitest';
import { parseScouting,applyScouting,matchScouting } from '../src/scouting.js';
const at='2026-11-07T16:00:00.000Z', kickoff='2026-11-08T01:00:00.000Z';
const fixture={home:'Toluca',away:'Monterrey',kickoff};
const entry={...fixture,observedAt:'2026-11-07T12:00:00Z',source:'https://club.example/report',quote:'Two fresh reserves named.',team:'away',facts:{freshReserves:true}};
it('joins only timestamped facts to the exact team pair and kickoff',()=>{
  const s=parseScouting({version:1,matchEvidence:[entry,{...entry,observedAt:'2026-11-07T18:00:00Z',facts:{mustWin:true}}]},at);
  expect(matchScouting(s,fixture)?.away).toEqual({freshReserves:true});
  expect(matchScouting(s,{...fixture,kickoff:'2026-11-09T01:00:00Z'})).toBeNull();
});
it('rejects caller-supplied absences and formula overrides in scouting evidence',()=>{
  for(const facts of [{confirmedStarOut:'Someone'},{stake:999}])
    expect(()=>parseScouting({version:1,matchEvidence:[{...entry,facts}]},at)).toThrow();
});
it('weights a named, already available result only after its source was published',()=>{
  const g={home:'Toluca',away:'Monterrey',date:'2026-10-10',stage:'regular',season:'2026',hg:5,ag:0,availableAt:Date.parse('2026-10-12')};
  const result={date:g.date,home:g.home,away:g.away,winner:'home',reason:'opponent_red_card',
    source:entry.source,quote:'Opponent finished with nine players.',observedAt:entry.observedAt};
  expect(applyScouting([g],parseScouting({version:1,distortedResults:[result]},at))[0].distortedWin).toBe('home');
  expect(applyScouting([g],parseScouting({version:1,distortedResults:[result]},'2026-11-06T12:00:00Z'))[0].distortedWin).toBeUndefined();
});
