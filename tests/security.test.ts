import {test,expect} from 'bun:test';
import {createOpencodeClient} from '@opencode-ai/sdk/client';
import {injectedHost,reviewRules} from '../src/host';
import {Engine} from '../src/engine';import {Store} from '../src/store';import {startServer} from '../src/server';
async function fixture(){const store=new Store(':memory:');const host={async create(){return 'session';},async submit(){},async inspect(){return {status:'running' as const};},async abort(){}};const engine=new Engine(store,host);const page=await startServer(engine,'/test-project');const u=new URL(page.url);return {store,engine,page,url:u.origin,token:u.hash.slice(1)};}
test('API denies missing token, foreign origin, absent CSRF and spoofed Host; serves no CORS',async()=>{
  const f=await fixture();const headers={Authorization:`Bearer ${f.token}`};
  try {
    expect((await fetch(f.url+'/api/state')).status).toBe(401);
    expect((await fetch(f.url+'/api/state',{headers:{...headers,Origin:'https://evil.test'}})).status).toBe(403);
    expect((await fetch(f.url+'/api/tasks',{method:'POST',headers:{...headers,Origin:f.url}})).status).toBe(403);
    expect((await fetch(f.url+'/api/tasks',{method:'POST',headers:{...headers,'X-Task-CSRF':f.token}})).status).toBe(403);
    expect((await fetch(f.url+'/api/state',{headers:{...headers,Host:'evil.test'}})).status).toBe(403);
    const r=await fetch(f.url+'/api/state',{headers});expect(r.status).toBe(200);expect(r.headers.get('access-control-allow-origin')).toBeNull();
    const text=await r.text();expect(text).not.toContain(f.token);expect(text).not.toContain('OPENCODE_SERVER_PASSWORD');
    expect((await fetch(f.url+'/')).headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect((await fetch(f.url+'/.env')).status).toBe(404);
  }finally{f.page.stop();await f.engine.stop();f.store.close();}
});
test('CRUD and idempotent API execution with real SQLite and HTTP',async()=>{
  const f=await fixture();const headers={Authorization:`Bearer ${f.token}`,'X-Task-CSRF':f.token,Origin:f.url,'Content-Type':'application/json'};
  const input={name:'<img src=x onerror=alert(1)>',prompt:'Read only',timezone:'Asia/Shanghai',schedule:{kind:'interval',minutes:5},enabled:true,misfire:'skip'};
  try {
    const created=await fetch(f.url+'/api/tasks',{method:'POST',headers,body:JSON.stringify(input)});expect(created.status).toBe(201);const t=await created.json();
    expect((await fetch(f.url+'/api/tasks/'+t.id,{method:'PUT',headers,body:JSON.stringify({...t,enabled:false})})).status).toBe(200);
    const run=()=>fetch(f.url+'/api/tasks/'+t.id+'/run',{method:'POST',headers:{...headers,'Idempotency-Key':'1234567890123456'}});
    expect((await run()).status).toBe(202);expect((await run()).status).toBe(202);await Promise.all([...f.engine.pending]);expect(f.store.runs().length).toBe(1);
    expect((await fetch(f.url+'/api/tasks/'+t.id,{method:'DELETE',headers})).status).toBe(409);
    await fetch(f.url+'/api/runs/'+f.store.runs()[0].id+'/cancel',{method:'POST',headers});
    expect((await fetch(f.url+'/api/tasks/'+t.id,{method:'DELETE',headers})).status).toBe(200);expect(f.store.tasks().length).toBe(0);
  }finally{f.page.stop();await f.engine.stop();f.store.close();}
});
test('injected SDK preserves backend authentication/directory and installs ask plus deny rules',async()=>{
  const requests:Request[]=[];
  const client=createOpencodeClient({baseUrl:'http://127.0.0.1:12345',headers:{Authorization:'Bearer simulation-only'},fetch:async(req)=>{
    requests.push(req.clone());const p=new URL(req.url).pathname;
    const value=p==='/config'?{permission:{bash:{'*':'allow','rm *':'deny'},edit:'deny'}}:p==='/agent'?[{name:'build',permission:[]}]:p==='/session'?{id:'session-test'}:undefined;
    return value?Response.json(value):new Response(null,{status:204});
  }});
  const host=injectedHost({client,directory:'/fixture-project'});const model={providerID:'fixture-provider',modelID:'fixture-model'};const sid=await host.create('Fixture',model);await host.submit(sid,'Read',model);
  expect(requests.length).toBe(4);for(const req of requests){expect(req.headers.get('authorization')).toBe('Bearer simulation-only');expect(new URL(req.url).searchParams.get('directory')).toBe('/fixture-project');}
  const create=await requests[2].json();expect(create.model).toEqual({id:'fixture-model',providerID:'fixture-provider'});expect((await requests[3].json()).model).toEqual(model);expect(create.permission).toEqual(reviewRules({bash:{'*':'allow','rm *':'deny'},edit:'deny'}));
  expect(create.permission.some((x:any)=>x.action==='allow')).toBe(false);
});
test('v2 agent rule arrays preserve only their actual deny rules',()=>{
  expect(reviewRules([{permission:'edit',pattern:'*.env',action:'deny'},{permission:'read',pattern:'*',action:'allow'}])).toEqual([{permission:'*',pattern:'*',action:'ask'},{permission:'edit',pattern:'*.env',action:'deny'}]);
});
