'use strict';
const el=id=>document.getElementById(id);
const node=(tag,value)=>{const n=document.createElement(tag);n.textContent=value;return n;};
const pct=v=>v==null?'—':(v*100).toFixed(1)+'%';
const money=v=>'$'+Number(v).toFixed(2);
const common={depth_unavailable:'Historical quotes do not include the available ask size.',model_missing:'Team ratings are unavailable.',no_edge:'The estimated edge does not cover the price and fees.',edge_below_threshold:'The net edge falls below the configured minimum.',stale_quote:'The recorded quote is too old.',unlinked:'The market has no unique fixture match.',edge_after_fees:'The estimated edge passes the configured paper threshold.'};
let token='',card,sessionId,revision;
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
  el('markets').replaceChildren();for(const m of c.markets){
    const article=node('article','');article.className='market';
    const head=node('div','');head.className='marketline';head.append(node('h3',m.label||m.ticker),node('span',m.decision==='paper_pick'?'Paper pick':'No bet'));
    const nums=node('div','');nums.className='numbers';metric(nums,'Ask',m.ask==null?'—':(100*m.ask).toFixed(1)+'¢');metric(nums,'Model',pct(m.model));metric(nums,'Combined',pct(m.probability));metric(nums,'Net edge',m.edge==null?'—':(100*m.edge).toFixed(1)+' pp');
    const reason=node('p',common[m.reason]||m.reason.replaceAll('_',' '));reason.className='decision';
    article.append(head,nums,reason);el('markets').append(article);
  }
  const src=el('sources');src.replaceChildren(node('p','Model · '+c.modelVersion),node('p',c.footballSource),node('p','News · '+c.providers.news));
  for(const m of c.markets){const p=node('p','');link(p,m.label+' · market observation',m.source);src.append(p);}
}
async function init(){
  try{const r=await request('/api/card');display(await r.json());const p=await(await request('/api/performance')).json();
    const target=el('performance');target.replaceChildren(node('p',p.settledContracts+' settled contracts · '+p.settledPaperPicks+' paper picks with a closing price.'));
    for(const k of ['market','model','combined'])if(p[k])target.append(node('p',k+' · Brier '+p[k].brier.toFixed(3)+' · log loss '+p[k].logLoss.toFixed(3)));

    target.append(node('h3','Historical comparison'));
    for(const row of p.historicalBenchmark.results)target.append(node('p',row.tournament+' · '+row.market.samples+' matches. Market log loss '+row.market.logLoss.toFixed(3)+', combined '+row.combined.logLoss.toFixed(3)+'. Lower is better.'));
  }catch(e){el('notice').hidden=false;el('notice').textContent=e.message;el('login').hidden=e.status!==401;}
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
