import {describe,it,expect} from 'vitest';
import {consult} from '../src/agent.js';

const get=(question:string,data:unknown)=>consult({question,read:async()=>data,audit:async()=>{}},'local');
describe('answers from run evidence',()=>{
  it('answers a team-specific question with persisted numbers and historical provenance',async()=>{
    const reply=await get('Explain the Toluca decision',{mode:'replay',asOf:'2026-11-07T16:00:00Z',markets:[
      {label:'Toluca',prior:.5,model:.53,probability:.51,ask:.55,fee:.01,edge:-.05,decision:'no_bet',reason:'edge_below_threshold'},
      {label:'Monterrey',probability:.25,decision:'no_bet',reason:'no_edge'},
    ]});
    expect(reply.answer).toContain('Historical replay');
    expect(reply.answer).toContain('Toluca');
    expect(reply.answer).toContain('combined 51.0%');
    expect(reply.answer).toContain('net edge -5.0 pp');
    expect(reply.answer).toContain('fee per contract 1.0¢');
    expect(reply.answer).toContain('2026-11-07T16:00:00Z');
    expect(reply.answer).not.toContain('Monterrey');
  });
  it('cites settled sample sizes and all measured metrics without imputing missing metrics',async()=>{
    const reply=await get('Evaluate historical performance',{mode:'replay',settledContracts:3,market:{count:3,brier:.13,logLoss:.45},model:null,combined:{count:2,brier:.14,logLoss:.51}});
    expect(reply.answer).toContain('3 settled contracts');
    expect(reply.answer).toContain('market Brier 0.1300 and log loss 0.4500 (3 scored)');
    expect(reply.answer).toContain('combined Brier 0.1400 and log loss 0.5100 (2 scored)');
    expect(reply.answer).not.toContain('model Brier');
  });
});
