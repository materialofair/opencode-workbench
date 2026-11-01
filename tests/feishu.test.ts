import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';import vm from 'node:vm';
import {prepare} from '../scripts/prepare-feishu';
import {FeishuDesktop} from '../adapters/feishu/plugin';
// Local helper reused with attribution from the audited Desktop adaptation.
// @ts-expect-error Original adaptation is plain JavaScript.
import {cleanMarkdown,splitMarkdownPages} from '../adapters/feishu/compact-markdown.mjs';
test('pinned Feishu adaptation reproducibly builds; dynamic backend/auth stays in memory',()=>{
  prepare();const code=readFileSync('.data/feishu/dist/index.desktop.js','utf8');
  const helper=code.slice(code.indexOf('function buildDesktopClientConfig('));
  const c=vm.createContext({URL,Buffer,process:{env:{}}});vm.runInContext(helper,c);
  const result=c.buildDesktopClientConfig({serverUrl:new URL('http://127.0.0.1:43210')},'/fixture',{OPENCODE_SERVER_PASSWORD:'fixture-only',OPENCODE_SERVER_USERNAME:'fixture'});
  expect(result.baseUrl).toBe('http://127.0.0.1:43210/');expect(result.headers.Authorization).toBe('Basic '+Buffer.from('fixture:fixture-only').toString('base64'));
  expect(()=>c.buildDesktopClientConfig({serverUrl:new URL('https://remote.invalid')},'/fixture',{})).toThrow();
  expect(code).not.toContain('"permission.ask": async');expect(code).toContain('OPENCODE_WORKBENCH_FEISHU_TELEMETRY !== "1"');
});
test('optional Feishu entry does not start gateway when test configuration is absent',async()=>{
  const old=process.env.OPENCODE_WORKBENCH_FEISHU_CONFIG;process.env.OPENCODE_WORKBENCH_FEISHU_CONFIG='/tmp/opencode-workbench-nonexistent-fixture.json';
  try{expect(await FeishuDesktop({directory:'/fixture'} as any)).toEqual({});}finally{if(old===undefined)delete process.env.OPENCODE_WORKBENCH_FEISHU_CONFIG;else process.env.OPENCODE_WORKBENCH_FEISHU_CONFIG=old;}
});
test('Feishu session routing reuses own chat session across restart; new command rotates it',async()=>{
  const code=readFileSync('.data/feishu/dist/index.desktop.js','utf8');
  const slice=code.slice(code.indexOf('var SESSION_KEY_PREFIX ='),code.indexOf('// src/feishu/quote.ts'));
  const make=()=>{const c=vm.createContext({TtlMap:class extends Map{constructor(_ttl:number){super();}},Map,Date});vm.runInContext(slice,c);return c;};
  let routing=make(),created=0;const saved:any[]=[];
  const client={session:{list:async()=>({data:saved}),create:async({body,query}:any)=>{expect(query.directory).toBe('/fixture');const s={id:`feishu-${++created}`,title:body.title,time:{created}};saved.push(s);return {data:s};}}};
  const key=routing.buildSessionKey('p2p','fixture-user');const a=await routing.getOrCreateSession(client,key,'/fixture');const b=await routing.getOrCreateSession(client,key,'/fixture');expect(a.id).toBe(b.id);
  routing=make();expect((await routing.getOrCreateSession(client,key,'/fixture')).id).toBe(a.id);routing.invalidateSession(key);expect((await routing.getOrCreateSession(client,key,'/fixture')).id).not.toBe(a.id);expect(created).toBe(2);
});
test('Markdown pagination preserves long Unicode content within escaped payload budgets',()=>{
  const source=cleanMarkdown('段落😀'.repeat(6000)+'\n\n```ts\n'+('console.log("中文😀");\n'.repeat(2000))+'```\n');
  const pages=splitMarkdownPages(source,12000);expect(pages.length).toBeGreaterThan(2);expect(pages.map((p:any)=>p.raw).join('')).toBe(source);
  for(const p of pages){expect(new TextEncoder().encode(JSON.stringify(p.text)).length-2).toBeLessThanOrEqual(12000);expect(p.text).not.toContain('\uFFFD');}
});
