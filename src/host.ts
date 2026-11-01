import type { PluginInput } from '@opencode-ai/plugin';
import type { RunStatus } from './store';
export type Snapshot = { status: RunStatus; note?: string };
export interface Host {
  create(title: string): Promise<string>;
  submit(sessionID: string, prompt: string): Promise<void>;
  inspect(sessionID: string): Promise<Snapshot>;
  abort(sessionID: string): Promise<void>;
}
type Rule = { permission: string; pattern: string; action: 'ask' | 'deny' };
export function reviewRules(permission: unknown): Rule[] {
  const result: Rule[] = [{permission:'*',pattern:'*',action:'ask'}];
  if (Array.isArray(permission)) for(const rule of permission) {
    if(rule?.action==='deny' && typeof rule.permission==='string' && typeof rule.pattern==='string')result.push({permission:rule.permission,pattern:rule.pattern,action:'deny'});
  }
  if (permission === 'deny') result.push({permission:'*',pattern:'*',action:'deny'});
  if (permission && typeof permission === 'object' && !Array.isArray(permission)) for (const [name,value] of Object.entries(permission)) {
    if (value === 'deny') result.push({permission:name,pattern:'*',action:'deny'});
    else if (value && typeof value === 'object') for (const [pattern,action] of Object.entries(value)) if (action==='deny') result.push({permission:name,pattern,action:'deny'});
  }
  return result;
}
// Uses the authenticated client injected by OpenCode. No localhost discovery, credentials,
// second backend, provider selection or configuration writes.
export function injectedHost(ctx: Pick<PluginInput,'client'|'directory'>): Host {
  const { client,directory } = ctx;
  const query = {directory};
  const agentsBySession=new Map<string,string>();
  return {
    async create(title) {
      const c=await client.config.get({query,signal:AbortSignal.timeout(10000)});
      if(c.error || !c.data) throw new Error('无法读取宿主权限配置');
      const config=c.data as typeof c.data & {default_agent?:string};
      const agent=config.default_agent || 'build';
      const a=await client.app.agents({query,signal:AbortSignal.timeout(10000)});
      if(a.error || !a.data)throw new Error('无法读取宿主 Agent 权限');
      const selected=a.data.find(x=>x.name===agent);
      if(!selected)throw new Error('找不到宿主默认 Agent，未提交任务');
      const rules=[...reviewRules(config.permission),...reviewRules(selected.permission).filter(r=>r.action==='deny')];
      const body={title,agent,permission:rules};
      // v1 SDK 1.19.5 omits permission in its TS declaration; the 1.19.5
      // backend accepts the v2 PermissionRuleset. Preserve host denies after ask.
      const r=await client.session.create({query,body,signal:AbortSignal.timeout(10000)});
      if(r.error || !r.data?.id) throw new Error('无法创建 OpenCode 会话');
      agentsBySession.set(r.data.id,agent);
      return r.data.id;
    },
    async submit(id,prompt) {
      const r=await client.session.promptAsync({path:{id},query,body:{agent:agentsBySession.get(id),parts:[{type:'text',text:prompt}]},signal:AbortSignal.timeout(10000)});
      agentsBySession.delete(id);
      if(r.error) throw new Error('OpenCode 未确认提交');
    },
    async inspect(id) {
      const [s,m]=await Promise.all([client.session.status({query,signal:AbortSignal.timeout(5000)}),client.session.messages({path:{id},query,signal:AbortSignal.timeout(5000)})]);
      if(s.error || m.error) throw new Error('无法读取运行状态');
      const messages=m.data ?? [];
      const assistants=messages.filter(x=>x.info.role==='assistant');
      if(assistants.some(x=>x.info.role==='assistant' && x.info.error)) return {status:'failed',note:'OpenCode 会话报告执行错误；请在宿主查看详情'};
      const active=s.data?.[id];
      if(active && active.type!=='idle') return {status:'running'};
      const last=assistants.at(-1)?.info;
      if(last?.role==='assistant' && last.time.completed && last.finish && !['tool-calls','unknown'].includes(last.finish)) return {status:'succeeded'};
      return {status:'uncertain',note:'未取得终态证据；不会自动重发，请到 OpenCode 会话核查'};
    },
    async abort(id) { const r=await client.session.abort({path:{id},query,signal:AbortSignal.timeout(10000)}); if(r.error) throw new Error('宿主未确认中止'); }
  };
}
