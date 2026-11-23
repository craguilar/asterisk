import {describe,it,expect} from 'vitest';
import {generateKeyPairSync,verify} from 'node:crypto';
import {accountReaders} from '../src/accounts.js';
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const pem=privateKey.export({type:'pkcs8',format:'pem'}).toString();
const identity={id:'test-key',pem};
describe('private account reads',()=>{
  it('rejects any key with additional scope before accessing the portfolio',async()=>{
    const paths:string[]=[];
    await expect(accountReaders({alice:identity},async input=>{
      paths.push(new URL(input.toString()).pathname);
      return Response.json({api_keys:[{api_key_id:'test-key',scopes:['read','write']}]});
    })).rejects.toThrow(/read-only/);
    expect(paths).toEqual(['/trade-api/v2/api_keys']);
  });
  it('signs fixed GET routes and limits results to the authenticated owner',async()=>{
    const paths:string[]=[];
    const accounts=await accountReaders({alice:identity},async(input,init)=>{
      const u=new URL(input.toString()),r=new Request(u,init);paths.push(u.pathname);
      expect(r.method).toBe('GET');
      expect(verify(null,Buffer.from(r.headers.get('kalshi-access-timestamp')+'GET'+u.pathname),publicKey,Buffer.from(r.headers.get('kalshi-access-signature')!,'base64'))).toBe(true);
      if(u.pathname.endsWith('api_keys'))return Response.json({api_keys:[{api_key_id:'test-key',scopes:['read']}]});
      if(u.pathname.endsWith('positions'))return Response.json({market_positions:[{ticker:'ABC',position_fp:'2.00'}],cursor:''});
      return Response.json({fills:[],cursor:''});
    });
    expect((await accounts('bob')).status).toBe('unavailable');
    expect(paths).toHaveLength(1);
    const result=await accounts('alice');expect(result.status).toBe('ok');expect(result.positions?.[0].ticker).toBe('ABC');expect(paths.filter(p=>p.includes('portfolio'))).toHaveLength(2);
  });
});
