'use strict';
const el=id=>document.getElementById(id);
const node=(tag,value)=>{const n=document.createElement(tag);n.textContent=value;return n;};
const pct=v=>v==null?'—':(v*100).toFixed(1)+'%';
const money=v=>'$'+Number(v).toFixed(2);
const common={depth_unavailable:'The quote has no verified executable ask size.',outside_horizon:'Kickoff is beyond the analysis window.',stale_at_consultation:'This saved quote has expired.',paper_position_recorded:'A paper allocation already exists for this contract.',model_missing:'Team ratings are unavailable.',no_edge:'The estimated edge does not cover the price and fees.',edge_below_threshold:'The net edge falls below the configured minimum.',stale_quote:'The recorded quote is too old.',unlinked:'The market has no unique fixture match.',edge_after_fees:'The estimated edge passes the configured paper threshold.'};
let token='',card,sessionId,revision,refreshTimer;
async function request(path,options={}){
  const headers={...options.headers};if(token)headers.Authorization='Bearer '+token;
  const res=await fetch(path,{...options,headers});if(!res.ok){const e=await res.json().catch(()=>({}));const error=new Error(e.error||'Request failed');error.status=res.status;throw error;}return res;
}
function link(parent,label,url){
  try{const u=new URL(url);if(u.protocol!=='https:')return;const a=node('a',label);a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';parent.append(a);}catch{}
}
function metric(parent,k,v){const s=node('span',k);s.append(node('strong',v));parent.append(s);}
function display(c){
  card=c;el('desk').hidden=false;el('login').hidden=true;el('notice').hidden=true;
  el('edition').textContent={live:'Live discovery',replay:'Historical replay',demo:'Simulated markets'}[c.mode]+'  /  Liga MX';
  const matches=[...new Set(c.markets.map(m=>m.match).filter(Boolean))];
  el('headline').textContent=matches.length===1?matches[0]:'Liga MX matchday';
  el('when').textContent='Quotes as of '+new Date(c.asOf).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'})+' UTC';
  el('exposure').textContent=money(c.exposure);el('cap').textContent='of '+money(c.dailyCap)+' daily cap';
  el('empty').hidden=!!c.markets.length;el('empty').textContent=c.status==='unavailable'?'Market feed unavailable. No predictions were issued.':'Kalshi returned no open Liga MX contracts.';
  const container=el('markets');
  container.replaceChildren();
  const byEvent=new Map();
  for(const m of c.markets){
    if(!byEvent.has(m.event))byEvent.set(m.event,[]);
    byEvent.get(m.event).push(m);
  }
  const grouped=[...byEvent.values()].sort((a,b)=>(a[0].kickoff||'z').localeCompare(b[0].kickoff||'z'));
  for(const group of grouped){
    const fixture=group[0];
    if(grouped.length>1){
      const header=node('header','');header.className='match-heading';
      header.append(node('h3',fixture.match||fixture.event));
      if(fixture.kickoff)header.append(node('time',new Date(fixture.kickoff).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'})));
      container.append(header);
    }
    for(const m of group){
    const article=node('article','');article.className='market';
    const head=node('div','');head.className='marketline';head.append(node('h3',m.label||m.ticker),node('span',m.decision==='paper_pick'?'Paper pick':'No bet'));
    const nums=node('div','');nums.className='numbers';metric(nums,'Ask',m.ask==null?'—':(100*m.ask).toFixed(1)+'¢');metric(nums,'Model',pct(m.model));metric(nums,'Combined',pct(m.probability));metric(nums,'Net edge',m.edge==null?'—':(100*m.edge).toFixed(1)+' pp');
    const reason=node('p',common[m.reason]||m.reason.replaceAll('_',' '));reason.className='decision';
    article.append(head,nums,reason);
    if(m.decision==='paper_pick'){
      const review=node('section','');review.append(node('h4','Unmodeled risks'));
      for(const risk of m.unmodeledRisks??[]){const p=node('p',risk.text+' ');link(p,'Source',risk.url);review.append(p);}
      if(!m.unmodeledRisks?.length)review.append(node('p','No additional sourced risks were identified.'));
      if(m.reviewer)review.append(node('small',m.reviewer));article.append(review);
    }
    if(m.stake>0)article.append(node('p','Paper allocation '+money(m.stake)+' · '+m.contracts+' contracts'));
    container.append(article);
    }
  }
  const src=el('sources');src.replaceChildren(node('p','Model · '+c.modelVersion),node('p',c.footballSource),node('p','News · '+c.providers.news));
  for(const feed of c.newsFeeds??[]){const p=node('p','');link(p,'News feed · '+feed.status+' · '+feed.count+' articles',feed.url);src.append(p);}
  for(const m of c.markets){const p=node('p','');link(p,m.label+' · market observation',m.source);src.append(p);}
}
async function init(){
  try{const r=await request('/api/card');display(await r.json());const p=await(await request('/api/performance')).json();
    const target=el('performance');target.replaceChildren(node('p',p.settledContracts+' settled contracts · '+p.settledPaperPicks+' settled paper picks · '+p.uniquePicksWithClv+' with a closing price.'));
    for(const k of ['market','model','combined'])if(p[k])target.append(node('p',k+' · Brier '+p[k].brier.toFixed(3)+' · log loss '+p[k].logLoss.toFixed(3)));

    if(card.mode==='live'){
      const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(card.asOf));
      const paper=await(await request('/api/matchday?date='+encodeURIComponent(day))).json();
      if(paper.matches.length){
        target.append(node('h3','Paper matchday · '+day));
        for(const m of paper.matches)target.append(node('p',m.home+' vs '+m.away+' · '+m.observations.length+' recorded forecasts · '+m.status.replaceAll('_',' ')));
      }
    }
    const audit=await(await request('/api/corrections')).json();
    if(audit.corrections.length){
      target.append(node('h3','Forecast corrections'));
      for(const change of audit.corrections){
        const item=node('p',change.ticker+' · revision '+change.revision+' · '+pct(change.originalProbability)+' → '+pct(change.correctedProbability)+' · '+change.reason+' ');
        link(item,'Source',change.source);target.append(item);
      }
    }
    target.append(node('h3','Historical comparison'));
    for(const row of p.historicalBenchmark.results)target.append(node('p',row.tournament+' · '+row.market.samples+' matches. Market log loss '+row.market.logLoss.toFixed(3)+', combined '+row.combined.logLoss.toFixed(3)+'. Lower is better.'));
  }catch(e){
    el('notice').hidden=false;el('notice').textContent=e.message;el('login').hidden=e.status!==401;
    if(card?.mode==='live')el('desk').hidden=true;
  }finally{
    clearTimeout(refreshTimer);
    if(card?.mode==='live')refreshTimer=setTimeout(init,60000);
  }
}
el('login').onsubmit=async e=>{e.preventDefault();token=el('token').value;el('token').value='';await init();};
el('ask').onsubmit=async e=>{e.preventDefault();const q=el('question').value.trim();if(!q)return;
  const target=el('answer');target.replaceChildren(node('p','Reading the evidence…'));el('submit').disabled=true;
  try{const result=await(await request('/api/consult',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q,sessionId,revision})})).json();
    sessionId=result.sessionId;revision=result.revision;target.replaceChildren(node('p',result.answer));
    if(result.data){const details=node('details','');details.append(node('summary','View supporting data'),node('pre',JSON.stringify(result.data,null,2)));target.append(details);}
    target.append(node('small','Answer source · '+result.provider));el('question').value='';
  }catch(e){target.textContent=e.message;}finally{el('submit').disabled=false;}
};
for(const b of document.querySelectorAll('.prompts button'))b.onclick=()=>{if(el('submit').disabled)return;el('question').value=b.textContent;el('ask').requestSubmit();};
el('download').onclick=async()=>{try{const response=await request('/api/card.md');const u=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=u;a.download='asterisk-'+card.mode+'-'+card.asOf.slice(0,10)+'.md';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}catch(e){el('notice').hidden=false;el('notice').textContent=e.message;}};
(async()=>{if(['localhost','127.0.0.1'].includes(location.hostname))await fetch('/api/local',{method:'POST'});await init();})();
