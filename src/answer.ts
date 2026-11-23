import { record, type ToolName } from './agent-contract.js';

function cents(value:unknown) {return typeof value==='number'?(100*value).toFixed(1)+'¢':'unavailable';}
function percentage(value:unknown) {
  return typeof value==='number' && Number.isFinite(value) ? (value*100).toFixed(1)+'%' : 'unavailable';
}
function number(value:unknown,digits=4) {
  return typeof value==='number' && Number.isFinite(value) ? value.toFixed(digits) : 'unavailable';
}
function searchable(value:string) {
  return value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}
export function describe(tool:ToolName,data:unknown,question:string) {
  const body=record(data)?data:{};
  const context=body.mode==='replay'?'Historical replay. ':body.mode==='demo'||body.simulated===true?'Simulated run. ':'';
  const stamp=typeof body.asOf==='string'?' Snapshot taken '+body.asOf+'.':'';
  if (tool==='get_positions') return typeof body.reason==='string'?body.reason:'Account data is unavailable.';
  if (tool==='get_run_status') {
    const count=typeof body.marketCount==='number'?' It contains '+body.marketCount+' markets.':'';
    const sources=record(body.providers)?Object.entries(body.providers).map(([k,v])=>k+' '+String(v)).join(', '):'';
    return context+'Latest saved run'+(typeof body.status==='string'?' is '+body.status:'')+'.'+count+stamp+(sources?' Providers: '+sources+'.':'');
  }
  if (tool==='get_performance') {
    if (typeof body.settledContracts!=='number') return context+'Ledger measurements are unavailable for this run.'+stamp;
    const count='The ledger contains '+body.settledContracts+' settled contract'+(body.settledContracts===1?'':'s')+'.';
    const scores=['market','model','combined'].flatMap(key=>{
      const s=body[key];
      return record(s)?[key+' Brier '+number(s.brier)+' and log loss '+number(s.logLoss)+' ('+s.count+' scored)']:[];
    });
    return context+count+' '+(scores.length?scores.join('; ')+'.':'No scored examples are available.')+
      (typeof body.realizedPnl==='number'?' Realized paper P&L: $'+number(body.realizedPnl,2)+'.':'')+
      (typeof body.meanClv==='number'?' Mean closing-line value: '+percentage(body.meanClv)+'.':'')+stamp;
  }
  const markets=Array.isArray(data)?data:body.markets;
  if (!Array.isArray(markets)) return context+'There are no market records in the requested evidence.'+stamp;
  if (!markets.length) return context+'The run recorded no markets. There are no picks to review.'+stamp;
  const rows=markets.filter(record);
  const query=' '+searchable(question)+' ';
  const matching=(field:string)=>rows.filter(row=>typeof row[field]==='string'&&query.includes(' '+searchable(String(row[field]))+' '));
  const ticker=matching('ticker'), label=matching('label');
  const selected=ticker.length?ticker:label.length?label:rows;
  const intro=tool==='list_markets'?'The run recorded '+rows.length+' market'+(rows.length===1?'. ':'s. '):'';
  const descriptions=selected.slice(0,3).map(row=>{
    const name=String(row.label??row.ticker??'Market');
    if(tool==='list_markets') return name+' — ask '+cents(row.ask)+', bid '+cents(row.bid)+'.';
    const decision=typeof row.decision==='string'?row.decision.replaceAll('_',' '):'decision unavailable';
    const reason=typeof row.reason==='string'?' ('+row.reason.replaceAll('_',' ')+')':'';
    const fields:[string,unknown][]=[['market prior',row.prior],['model',row.model],['combined',row.probability],['ask',row.ask],['fee per contract',row.fee],['net edge',row.edge]];
    const values=fields.filter(([,value])=>typeof value==='number').map(([key,value])=>key+' '+(['ask','fee per contract'].includes(key)?cents(value):key==='net edge'?(100*Number(value)).toFixed(1)+' pp':percentage(value)));
    return name+' — '+decision+reason+'.'+(values.length?' '+values.join(', ')+'.':'')+
      (decision==='paper pick' && typeof row.stake==='number'?' Paper exposure $'+number(row.stake,2)+'.':'');
  });
  return context+intro+descriptions.join(' ')+stamp;
}
