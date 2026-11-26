import { describe } from './answer.js';
import { createHash } from 'node:crypto';
import { anthropicRouter } from './anthropic.js';
import { agentDefinition, isTool, record, redact, type ModelPort, type ToolName } from './agent-contract.js';
export { agentDefinition, definitionDigest, type ModelPort } from './agent-contract.js';

export interface Consultation {
  question: string;
  previousTool?: string;
  read(tool: string): Promise<unknown>;
  audit(tool: string, status: string, inputHash: string, durationMs: number): Promise<void>;
}
interface Usage { inputTokens: number; outputTokens: number }
type Status = 'ok' | 'unavailable' | 'blocked' | 'clarify';

const emptyArgumentsHash = createHash('sha256').update('{}').digest('hex');
const local: ModelPort = {
  id:'local-router',
  async select({question, previousTool}) {
    const topics: [RegExp, ToolName][] = [
      [/\b(positions?|fills?|holdings?|portfolio|posiciones)\b/i, 'get_positions'],
      [/\b(perform(?:ance|ed)?|accuracy|brier|calibration|clv|backtest|correct|historical|ledger|rendimiento)\b/i, 'get_performance'],
      [/\b(fresh(?:ness)?|as.of|updated|status|stale|last run|ingestion|estado)\b/i, 'get_run_status'],
      [/\b(why|explain|evidence|reason|reasoning|risk|por qu[eé]|explica|how.*(?:calculated|computed))\b/i, 'explain_prediction'],
      [/\b(picks?|cards?|bets?|opportunit(?:y|ies)|recommendations?|recommend|summary|predict(?:ion|ions)?|pron[oó]stico)\b/i, 'get_pick_card'],
      [/\b(markets?|listings?|odds|prices?|mercados?)\b/i, 'list_markets'],
    ];
    const tool = topics.find(([pattern])=>pattern.test(question))?.[1]
      ?? (/\b(more|again|those|that|details|repeat|what about|how about|m[aá]s)\b/i.test(question) ? previousTool : undefined);
    return tool ? {tool,input:{}} : null;
  },
};

function configuredProvider(): ModelPort {
  const selected = process.env.ANALYST_PROVIDER || 'local';
  if (selected === 'local') return local;
  if (selected === 'anthropic') return anthropicRouter(process.env.ANTHROPIC_API_KEY || '', process.env.ANTHROPIC_MODEL || '');
  return {id:'unconfigured', select:async()=>{throw Error('Unknown analyst provider.');}};
}

function validatedUsage(value: unknown): value is Usage {
  if (!record(value)) return false;
  const valid = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  return valid(value.inputTokens) && valid(value.outputTokens) && Number(value.outputTokens) <= 128;
}

function publicData(value: unknown): unknown {
  const content = JSON.stringify(value, (key, field: unknown) => {
    if (/^(?:(?:api|private)[_-]?key|.*(?:password|token|secret)|authorization|cookie|database_url|principal(?:Id)?|userId|email)$/i.test(key)) return undefined;
    return typeof field === 'string' ? redact(field) : field;
  });
  if (!content || Buffer.byteLength(content) > 1_000_000) throw Error('Evidence outside response budget.');
  return JSON.parse(content);
}
function within<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(Error('Deadline reached.'));
  return new Promise<T>((resolve,reject) => {
    const stop = () => reject(Error('Deadline reached.'));
    signal.addEventListener('abort',stop,{once:true});
    task.then(resolve,reject).finally(()=>signal.removeEventListener('abort',stop));
  });
}

export async function consult(context: Consultation, requestedProvider?: ModelPort | 'local') {
  const provider = requestedProvider === 'local' ? local : requestedProvider ?? configuredProvider();
  const signal = AbortSignal.timeout(10_000);
  let usage: Usage = {inputTokens:0,outputTokens:0};
  const reply = (status: Status, tool: string, answer: string, data: unknown = null) => ({
    agent:agentDefinition.id,promptVersion:agentDefinition.version,provider:provider.id,status,tool,answer,data,usage,
  });
  if (typeof context.question !== 'string' || !context.question.trim() || context.question.length > 2_000) {
    return reply('clarify','none','Enter a question of up to 2,000 characters.');
  }
  const question = redact(context.question.trim());
  if (/\b(?:place|submit|create|cancel|modify|execute)\s+(?:(?:a|an|the|my|this|buy|sell|new|all|that)\s+){0,4}(?:orders?|bets?|trades?)\b|\b(?:buy|sell|wager)\s+(?:\d+|\$|the|some|my|all|now)\b|\b(?:override|bypass|ignore)\s+(?:(?:the|all|your|my|previous|prior|risk)\s+){0,4}(?:limits?|caps?|instructions?|guards?)\b/i.test(question)) {
    return reply('blocked','none','Asterisk provides read-only analysis. You can ask about a recorded paper decision.');
  }
  let tool: ToolName | undefined;
  const start = Date.now();
  try {
    const selected = await within(provider.select({question,previousTool:isTool(context.previousTool) ? context.previousTool : undefined,signal}),signal);
    if (provider === local && !selected) return reply('clarify','none','Ask about markets, the pick card, a decision, run status, performance, or positions.');
    if (!record(selected) || !isTool(selected.tool) || !record(selected.input) || Object.keys(selected.input).length ||
      Object.keys(selected).some(key=>!['tool','input','usage'].includes(key)) || ('usage' in selected && !validatedUsage(selected.usage))) {
      return reply('blocked','none','The analyst returned an invalid tool selection.');
    }
    if (validatedUsage(selected.usage)) usage = selected.usage;
    tool = selected.tool;
    const data = publicData(await within(context.read(tool),signal));
    if (data === null) throw Error('No evidence');
    await within(context.audit(tool,'ok',emptyArgumentsHash,Date.now()-start),signal).catch(()=>{});
    return reply('ok',tool,describe(tool,data,question),data);
  } catch {
    if (tool && !signal.aborted) await within(context.audit(tool,'error',emptyArgumentsHash,Date.now()-start),signal).catch(()=>{});
    return reply('unavailable',tool ?? 'none','The requested evidence is unavailable. No estimate was generated.');
  }
}
