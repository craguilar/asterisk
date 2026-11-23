import { describe, expect, it } from 'vitest';
import { verifyMatchNews, enrichNews, type ExtractionProvider } from '../src/news.js';

const fixture = {home:'Toluca',away:'Monterrey',kickoff:'2026-05-09T01:00:00Z'};
const asOf='2026-05-08T23:00:00Z';
const quote='El club anunció que Ana Gómez es baja por lesión.';
const article=(url:string, publishedAt='2026-05-08T18:00:00Z')=>({
  url,publishedAt,team:'Toluca',language:'es',text:quote,
  claims:[{type:'player_out',value:'Ana Gómez',confidence:'high',quote}],
});
const options = {officialDomains:{Toluca:['tolucafc.com']},stars:{Toluca:['Ana Gómez']}};
const review = (articles:unknown[], lineups:unknown[]=[],provider?:ExtractionProvider) =>
  verifyMatchNews({...fixture,articles,lineups},asOf,options,provider);

describe('dated and cited football observations',()=>{
  it('deduplicates a publisher across multi-level suffixes, then accepts independent corroboration',async()=>{
    const copy=[article('https://www.deportes.com.mx/report'),article('https://sport.deportes.com.mx/report')];
    const one=await review(copy);
    expect(one.flags[0]).toMatchObject({type:'player_doubtful',status:'doubtful'});
    expect(one.homeFacts.confirmedStarOut).toBeUndefined();
    const two=await review([...copy,article('https://example.org/report')]);
    expect(two.homeFacts.confirmedStarOut).toBe('Ana Gómez');
    expect(two.flags[0].citations).toHaveLength(3);
  });
  it('requires an exact supporting quote and rejects predictions and probabilistic fields',async()=>{
    const a=article('https://tolucafc.com/news');
    for (const bad of [{...a.claims[0],quote:'fabricated claim'},{...a.claims[0],p:0.99},
      {...a.claims[0],quote:'Toluca wins 2-0'}, {...a.claims[0],value:'Unrelated player'}]) {
      expect((await review([{...a,text:a.text+' Toluca wins 2-0',claims:[bad]}])).flags).toHaveLength(0);
    }
  });
  it('drops lookahead and honors an official starting XI at the time it is known',async()=>{
    const trusted=article('https://tolucafc.com/news');
    expect((await review([trusted,article('https://example.org/later','2026-05-09T00:01:00Z')])).flags[0].citations).toHaveLength(1);
    const lineup={team:'Toluca',publishedAt:'2026-05-08T20:01:00Z',url:'https://tolucafc.com/xi',starters:['Ana Gómez']};
    expect((await review([trusted],[lineup])).flags[0].status).toBe('superseded');
    expect((await review([trusted],[{...lineup,url:'https://tolucafc.com.impersonator.org/xi'}])).homeFacts.confirmedStarOut).toBe('Ana Gómez');
  });
  it('requires an operator-designated star and processes English rotation reports',async()=>{
    const rotated={url:'https://example.org/new',publishedAt:'2026-05-08T16:00:00Z',language:'en',team:'Monterrey',text:'The coach will rotate the starting lineup.',
      claims:[{type:'rotation_risk',value:'high',confidence:'high',quote:'The coach will rotate the starting lineup.'}]};
    const news=await verifyMatchNews({...fixture,articles:[article('https://tolucafc.com/news'),rotated]},asOf,{...options,stars:{}});
    expect(news.awayFacts.rotationHigh).toBe(true);
    expect(news.homeFacts.confirmedStarOut).toBeUndefined();
  });
  it('limits malformed model retries and stores zero invented observations',async()=>{
    let calls=0;
    const provider:ExtractionProvider={extract:async()=>{calls++;return {probability:1};}};
    const result=await review([article('https://example.org/a')],[],provider);
    expect(calls).toBe(2);
    expect(result.rejectedArticles).toBe(1);
    expect(result.flags).toHaveLength(0);
  });
  it('limits adversarial reviews to paper picks and preserves the decision numbers',async()=>{
    const row={decision:'paper_pick',probability:.45,stake:1,risks:['Price can change.'],uncertainty:[],cancelIf:[],newsFlags:[]};
    const card={asOf,markets:[row,{...row,decision:'no_bet'}],providers:{news:'unconfigured'}};
    const out=await enrichNews(card,'local');
    expect(out.markets[0]).toMatchObject({probability:.45,stake:1,decision:'paper_pick'});
    expect(out.markets[0].uncertainty.join(' ')).toMatch(/no verified/i);
    expect(out.markets[1]).toEqual(card.markets[1]);
  });
});
