import {afterEach,describe,expect,it,vi} from 'vitest';
import {parseFeed,readFeeds,feedRegistry} from '../src/rss.js';
import {loadNewsReport,enrichNews} from '../src/news.js';
import {buildCard,markdownCard} from '../src/pipeline.js';
import * as football from '../src/football.js';
import * as kalshi from '../src/kalshi.js';

const fixture={home:'Toluca',away:'Monterrey',kickoff:'2026-05-09T01:00:00Z'};
const at='2026-05-08T23:00:00Z';
const feed=feedRegistry['espn-soccer'].url;
const atom='<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Toluca prepares</title><link rel="alternate" href="https://www.espn.com/soccer/story/toluca"/><published>2026-05-08T18:00:00Z</published><summary>Toluca will rotate the starting lineup. The match is against Monterrey.</summary></entry></feed>';
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('public news feeds and sourced reviews',()=>{
  it('reads Atom links, rejects DTD/depth, and blocks unexpected source destinations before I/O',async()=>{
    expect(parseFeed(atom,feed)[0].text).toContain('Toluca will rotate');
    expect(parseFeed(atom.replace('2026-05-08T18:00:00Z','Fri, 08 May 2026 14:00:00 EDT'),feed)[0].publishedAt).toBe('2026-05-08T18:00:00.000Z');
    expect(()=>parseFeed('<!DOCTYPE rss><rss/>',feed)).toThrow();
    expect(()=>parseFeed('<feed>'+'<x>'.repeat(80)+'</x>'.repeat(80)+'</feed>',feed)).toThrow();
    const http=vi.fn();
    await expect(readFeeds('https://other.example.org/feed',http)).rejects.toThrow();
    expect(http).not.toHaveBeenCalled();
  });
  it('limits bytes including chunked data and records the failed feed',async()=>{
    const rows=await readFeeds('espn-soccer',async()=>new Response('x'.repeat(600_000)));
    expect(rows[0].status).toBe('unavailable');
    expect(rows[0].articles).toEqual([]);
  });
  it('applies feed evidence before the normal live daily card calculates outcomes',async()=>{
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(at));
    vi.stubEnv('ASTERISK_NEWS_FILE','');vi.stubEnv('ASTERISK_NEWS_FEEDS','espn-soccer');
    vi.stubEnv('ASTERISK_NEWS_PROVIDER','anthropic');vi.stubEnv('ASTERISK_EXTRACT_MODEL','test-extractor');vi.stubEnv('ANTHROPIC_API_KEY','test');
    vi.spyOn(football,'footballContext').mockResolvedValue({matches:[{...fixture,aliasesHome:[],aliasesAway:[],lambdaHome:1.6,lambdaAway:1,rho:0}],source:'Test fixture'} as Awaited<ReturnType<typeof football.footballContext>>);
    const event='KXLIGAMXGAME-26MAY08TOLMON';
    vi.spyOn(kalshi,'readMarkets').mockResolvedValue(['Toluca','Tie','Monterrey'].map((label,i)=>({
      event,label,ticker:event+'-'+i,title:label,status:'active',rules:'Regulation time including stoppage time.',
      updated:at,open:'2026-05-01T20:00:00Z',close:fixture.kickoff,ask:[.52,.28,.26][i],bid:.21,last:null,volume:100,askSize:100,
    })));
    vi.stubGlobal('fetch',async(input:string)=>String(input)===feed?new Response(atom):Response.json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({claims:[{type:'rotation_risk',confidence:'high',value:'high',quote:'Toluca will rotate the starting lineup.'}]})}]}));
    const card=await buildCard('live',new Date(at));
    expect(card.newsFeeds?.[0]).toMatchObject({url:feed,count:1,status:'ok'});
    const home=card.markets.find(r=>r.outcome==='home')!;
    expect(home.rules.some(r=>r.id==='R06'&&r.applied<0)).toBe(true);
    expect(home.newsFlags?.[0].citations[0].url).toBe('https://www.espn.com/soccer/story/toluca');
  });
  it('retrieves a feed once, never follows article URLs, and validates two separate model requests',async()=>{
    vi.stubEnv('ASTERISK_NEWS_FILE','');vi.stubEnv('ASTERISK_NEWS_FEEDS','espn-soccer');
    vi.stubEnv('ASTERISK_NEWS_PROVIDER','anthropic');vi.stubEnv('ASTERISK_REVIEW_PROVIDER','anthropic');
    vi.stubEnv('ASTERISK_EXTRACT_MODEL','fast-fixture');vi.stubEnv('ASTERISK_REVIEW_MODEL','strong-fixture');vi.stubEnv('ANTHROPIC_API_KEY','test');
    const sent:any[]=[];
    const http=vi.fn(async(input:any,init:any)=>{
      expect(init.redirect).toBe('error');
      if(String(input)===feed)return new Response(atom);
      expect(String(input)).toBe('https://api.anthropic.com/v1/messages');
      const body=JSON.parse(init.body);sent.push(body);
      const result=body.model==='fast-fixture'?{claims:[{type:'rotation_risk',confidence:'high',value:'high',quote:'Toluca will rotate the starting lineup.'}]}:{ids:['A']};
      return Response.json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(result)}]});
    });
    vi.stubGlobal('fetch',http);
    const report=await loadNewsReport(at,[fixture]);
    expect(report.evidence[0].homeFacts.rotationHigh).toBe(true);
    expect(report.feeds[0]).toMatchObject({url:feed,status:'ok',count:1});
    const row={decision:'paper_pick',probability:.4,stake:1,risks:[],uncertainty:[],cancelIf:[],newsFlags:report.evidence[0].flags,rules:[]};
    const card=await enrichNews({markets:[row,{...row,decision:'no_bet'}],providers:{news:'ok'}});
    expect(sent.map(b=>b.model)).toEqual(['fast-fixture','strong-fixture']);
    expect(sent[0].temperature).toBe(0);expect(sent.every(b=>b.output_config.format.type==='json_schema')).toBe(true);
    expect(card.markets[0]).toMatchObject({probability:.4,stake:1,unmodeledRisks:[{url:'https://www.espn.com/soccer/story/toluca'}]});
    expect(card.markets[1]).not.toHaveProperty('unmodeledRisks');
    expect(http).toHaveBeenCalledTimes(3);
    const demo=await buildCard('demo',new Date(at));
    const stored=demo.markets[0]!;
    stored.decision='paper_pick';stored.unmodeledRisks=[{text:'Published rotation report.',url:'https://www.espn.com/soccer/story/toluca',publishedAt:at}];
    expect(markdownCard(demo)).toContain('### Unmodeled risks\n\nPublished rotation report. · https://www.espn.com/soccer/story/toluca');
  });
});
