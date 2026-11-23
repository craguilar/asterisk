import {createPrivateKey,constants,sign} from 'node:crypto';
import {z} from 'zod';

const pair=z.object({id:z.string().min(1),pem:z.string().min(1)}).strict();
const keyInfo=z.object({api_keys:z.array(z.object({api_key_id:z.string(),scopes:z.array(z.string())}))});
const position=z.object({ticker:z.string(),position_fp:z.string(),market_exposure_dollars:z.string().optional(),last_updated_ts:z.string().optional()});
const fill=z.object({ticker:z.string(),count_fp:z.string(),yes_price_dollars:z.string().optional(),created_time:z.string().optional()});
const base='https://external-api.kalshi.com';
type Result={status:'ok'|'unavailable',source:string,asOf:string,reason?:string,positions?:z.infer<typeof position>[],recentFills?:z.infer<typeof fill>[],positionsTruncated?:boolean,fillsTruncated?:boolean};
export async function accountReaders(config:unknown,fetchImpl:typeof fetch=fetch) {
  const keys=z.record(z.string(),pair).parse(config);
  const readers=new Map<string,()=>Promise<Result>>();
  for(const [principal,c] of Object.entries(keys)){
    const key=createPrivateKey(c.pem);
    if(!['rsa','ed25519'].includes(key.asymmetricKeyType??''))throw Error('Unsupported account key algorithm');
    const get=async(route:'api_keys'|'portfolio/positions'|'portfolio/fills')=>{
      const path='/trade-api/v2/'+route,stamp=String(Date.now()),message=Buffer.from(stamp+'GET'+path);
      const signature=key.asymmetricKeyType==='ed25519'?sign(null,message,key):sign('sha256',message,{key,padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:32});
      const res=await fetchImpl(base+path+(route==='api_keys'?'':'?limit=100'),{method:'GET',redirect:'error',signal:AbortSignal.timeout(4000),
        headers:{'KALSHI-ACCESS-KEY':c.id,'KALSHI-ACCESS-TIMESTAMP':stamp,'KALSHI-ACCESS-SIGNATURE':signature.toString('base64')}});
      if(!res.ok)throw Error('Kalshi account read unavailable');
      return res.json();
    };
    const scope=async()=>{
      const identity=keyInfo.parse(await get('api_keys')).api_keys.find(k=>k.api_key_id===c.id);
      if(identity?.scopes.length!==1||identity.scopes[0]!=='read')throw Error('A verified read-only account key is required');
    };
    await scope();
    readers.set(principal,async()=>{
      await scope();
      const [p,f]=await Promise.all([get('portfolio/positions'),get('portfolio/fills')]);
      const positions=z.object({market_positions:z.array(position),cursor:z.string().optional()}).parse(p);
      const fills=z.object({fills:z.array(fill),cursor:z.string().optional()}).parse(f);
      return {source:base,status:'ok',asOf:new Date().toISOString(),positions:positions.market_positions,recentFills:fills.fills,positionsTruncated:!!positions.cursor,fillsTruncated:!!fills.cursor};
    });
  }
  return async(principal:string):Promise<Result>=>{
    const reader=readers.get(principal);
    if(reader)return reader();
    return {status:'unavailable',asOf:new Date().toISOString(),source:'Kalshi account',reason:'No read-only account configured for this analyst.'};
  };
}
