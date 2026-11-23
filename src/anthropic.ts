import { agentDefinition, record, type ModelPort } from './agent-contract.js';

export function anthropicRouter(apiKey:string, model:string, http:typeof fetch = fetch): ModelPort {
  return {
    id: 'anthropic/' + model,
    async select({question,previousTool,signal}) {
      if (!apiKey || !model) throw Error('Analyst provider is not configured.');
      const res = await http('https://api.anthropic.com/v1/messages', {
        method:'POST', redirect:'error', signal,
        headers: {'content-type':'application/json','anthropic-version':'2023-06-01','x-api-key':apiKey},
        body:JSON.stringify({
          model, max_tokens:128, system:agentDefinition.prompt,
          tools:Object.entries(agentDefinition.tools).map(([name,description])=>({
            name, description, input_schema:{type:'object', properties:{}, additionalProperties:false},
          })),
          tool_choice:{type:'any',disable_parallel_tool_use:true},
          messages:[{role:'user',content:JSON.stringify({question,previousTool})}],
        }),
      });
      if (!res.ok) throw Error('Hosted analyst provider unavailable.');
      const message:unknown = await res.json();
      if (!record(message) || message.stop_reason !== 'tool_use' || !Array.isArray(message.content) || message.content.length !== 1) {
        return null;
      }
      const call = message.content[0];
      if (!record(call) || call.type !== 'tool_use' || !record(message.usage)) return null;
      return {tool:call.name,input:call.input,usage:{inputTokens:message.usage.input_tokens,outputTokens:message.usage.output_tokens}};
    },
  };
}
