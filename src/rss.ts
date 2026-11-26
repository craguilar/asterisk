import {SaxesParser} from 'saxes';

export const feedRegistry={
  'espn-soccer':{url:'https://www.espn.com/espn/rss/soccer/news',language:'en',articleHosts:['www.espn.com','www.espnfc.com']},
  'bbc-football':{url:'https://feeds.bbci.co.uk/sport/football/rss.xml',language:'en',articleHosts:['www.bbc.com','www.bbc.co.uk']},
  'elpais-deportes':{url:'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/deportes/portada',language:'es',articleHosts:['elpais.com']},
} as const;
type FeedId=keyof typeof feedRegistry;
export interface FeedArticle {title:string;url:string;text:string;publishedAt:string}
export interface FeedStatus {url:string;status:'ok'|'unavailable';count:number}
const maximumBytes=512*1024;
const maximumEntries=100;
function plain(text:string){
  return text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<[^>]+>/g,' ')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/gi,x=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&#39;':"'",'&nbsp;':' '}[x.toLowerCase()]??' '))
    .replace(/\s+/g,' ').trim();
}
function publicLink(text:string,source:string){
  try {
    const u=new URL(text,source);
    if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port)return null;
    u.protocol='https:';u.hash='';
    for(const key of [...u.searchParams.keys()])if(/^utm_|^at_|^cmpid$/i.test(key))u.searchParams.delete(key);
    return u.href;
  }catch{return null;}
}
export function parseFeed(xml:string,source:string):FeedArticle[] {
  if(Buffer.byteLength(xml)>maximumBytes)throw Error('Feed exceeded byte limit.');
  const parser=new SaxesParser();
  let depth=0,entryDepth=0,root='',field='',text='',entries=0;
  let values:Record<string,string>={};
  const articles:FeedArticle[]=[];
  const links=new Set<string>();
  parser.on('doctype',()=>{throw Error('Feed DTDs are unsupported.');});
  parser.on('opentag',tag=>{
    if(++depth>48)throw Error('Feed nesting exceeded limit.');
    const name=tag.name.toLowerCase().split(':').at(-1)!;
    if(depth===1){
      root=name;
      if(!['rss','feed','rdf'].includes(root))throw Error('Unsupported feed format.');
    }
    const atomEntry=root==='feed'&&depth===2&&name==='entry';
    const rssItem=name==='item'&&((root==='rss'&&depth===3)||(root==='rdf'&&depth===2));
    if(!entryDepth && (atomEntry||rssItem)) {
      entryDepth=depth;values={};entries++;return;
    }
    if(entryDepth && depth===entryDepth+1 && entries<=maximumEntries) {
      field=name;text='';
      if(name==='link' && (!tag.attributes.rel||tag.attributes.rel==='alternate') && typeof tag.attributes.href==='string')values.link=tag.attributes.href;
    }
  });
  const add=(s:string)=>{if(field && text.length<16000)text+=s.slice(0,16000-text.length);};
  parser.on('text',add);parser.on('cdata',add);
  parser.on('closetag',()=>{
    if(entryDepth && depth===entryDepth+1 && field) {
      if(text.trim() && !values[field])values[field]=text.trim();
      field='';text='';
    }
    if(entryDepth && depth===entryDepth) {
      const link=values.link && publicLink(values.link,source);
      const date=values.published??values.pubdate??values.date??values.updated;
      const title=plain(values.title??''),body=plain(values.encoded??values.content??values.description??values.summary??'');
      const offsets:Record<string,string>={EST:'-0500',EDT:'-0400',CST:'-0600',CDT:'-0500',MST:'-0700',MDT:'-0600',PST:'-0800',PDT:'-0700'};
      const zoned=date?.replace(/\b(?:EST|EDT|CST|CDT|MST|MDT|PST|PDT)$/i,zone=>offsets[zone.toUpperCase()]!);
      const timestamp=zoned&&/(?:Z|GMT|UTC|[+-]\d\d:?\d\d)$/i.test(zoned)?Date.parse(zoned):NaN;
      if(link && !links.has(link) && Number.isFinite(timestamp) && (title||body)){
        articles.push({url:link,publishedAt:new Date(timestamp).toISOString(),title,text:[title,body].filter(Boolean).join('\n').slice(0,16_000)});
        links.add(link);
      }
      entryDepth=0;values={};
    }
    depth--;
  });
  parser.write(xml).close();
  return articles;
}
async function loadFeed(url:string,http:typeof fetch){
  const response=await http(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(4000),
    headers:{accept:'application/rss+xml, application/atom+xml, application/xml, text/xml'}});
  if(!response.ok||!response.body)throw Error('Feed unavailable.');
  const reader=response.body.getReader();
  try{
    if(Number(response.headers.get('content-length'))>maximumBytes)throw Error('Feed exceeded byte limit.');
    const chunks:Buffer[]=[];let size=0;
    for(;;){
      const part=await reader.read();if(part.done)break;
      size+=part.value.byteLength;if(size>maximumBytes)throw Error('Feed exceeded byte limit.');
      chunks.push(Buffer.from(part.value));
    }
    return parseFeed(Buffer.concat(chunks).toString('utf8'),url);
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function readFeeds(config:string,http:typeof fetch=fetch) {
  const ids=[...new Set(config.split(',').map(x=>x.trim()).filter(Boolean))];
  if(ids.length>3 || ids.some(id=>!Object.hasOwn(feedRegistry,id)))throw Error('Select one to three registered public news feeds.');
  return Promise.all(ids.map(async name=>{
    const {url,language,articleHosts}=feedRegistry[name as FeedId];
    try{
      const items=await loadFeed(url,http);
      const articles=items.filter(item=>(articleHosts as readonly string[]).includes(new URL(item.url).hostname));
      return {url,language,status:'ok' as const,count:articles.length,articles};
    }catch{return {url,language,status:'unavailable' as const,count:0,articles:[] as FeedArticle[]};}
  }));
}
