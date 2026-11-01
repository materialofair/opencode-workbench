import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Engine } from './engine';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
const assets = new URL('../public/',import.meta.url);
const sharedHeaders = { 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer', 'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'", 'Cross-Origin-Resource-Policy':'same-origin', 'X-Frame-Options':'DENY' };
function equal(a:string,b:string) { const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length && timingSafeEqual(x,y); }
async function body(req:Request) {
  const reader=req.body?.getReader(); if(!reader) throw new Error('缺少请求内容');
  let size=0;const chunks:Uint8Array[]=[];
  while(true) { const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>65536){await reader.cancel();throw new Error('请求内容过大');}chunks.push(r.value); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function startServer(engine:Engine, directory:string, demo=false) {
  const token=randomBytes(32).toString('base64url');
  const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{...sharedHeaders,'Content-Type':'application/json; charset=utf-8'}});
  let port=0;
  async function handle(req:Request) {
      const u=new URL(req.url); const origin=`http://127.0.0.1:${port}`;
      if(u.origin!==origin || req.headers.get('host')!==`127.0.0.1:${port}`) return json({error:'Host rejected'},403);
      const suppliedOrigin=req.headers.get('origin');
      if(suppliedOrigin && suppliedOrigin!==origin) return json({error:'Origin rejected'},403);
      if(req.headers.get('sec-fetch-site')==='cross-site') return json({error:'Cross-site request rejected'},403);
      if(u.pathname.startsWith('/api/')) {
        if(!equal(req.headers.get('authorization')??'',`Bearer ${token}`)) return json({error:'页面授权已失效，请重新对 OpenCode 说“打开定时任务管理”'},401);
        if(req.method!=='GET' && (suppliedOrigin!==origin || !equal(req.headers.get('x-task-csrf')??'',token))) return json({error:'CSRF rejected'},403);
        try {
          if(u.pathname==='/api/state' && req.method==='GET') return json({tasks:engine.store.tasks(),runs:engine.store.runs(),directory,leader:engine.leader,demo,concurrency:engine.concurrency,now:Date.now(),lifecycle:'调度随此 OpenCode 后端运行。真正退出、休眠、关机时不能准点执行。'});
          if(u.pathname==='/api/tasks' && req.method==='POST') { const v=await body(req);return json(engine.store.save(v),201); }
          const match=u.pathname.match(/^\/api\/tasks\/([a-f0-9-]+)(\/run)?$/);
          if(match) {
            const id=match[1];
            if(match[2] && req.method==='POST') {
              const key=req.headers.get('idempotency-key')??'';
              if(!/^[a-zA-Z0-9-]{16,80}$/.test(key))return json({error:'缺少有效去重键'},400);
              return json(engine.runNow(id,key),202);
            }
            if(!match[2] && req.method==='PUT') { const v=await body(req);return json(engine.store.save(v,id,v.revision)); }
            if(!match[2] && req.method==='DELETE') {
              if(engine.store.active().some(r=>r.taskID===id)) return json({error:'此任务仍有运行，请先中止后再删除'},409);
              engine.store.delete(id);return json({ok:true});
            }
          }
          const cancel=u.pathname.match(/^\/api\/runs\/([a-f0-9-]+)\/cancel$/);
          if(cancel && req.method==='POST'){await engine.cancel(cancel[1]);return json({ok:true});}
          return json({error:'接口不存在'},404);
        } catch(e) { return json({error:e instanceof Error?e.message:'请求失败'},400); }
      }
      if(req.method!=='GET')return json({error:'Method rejected'},405);
      const names:Record<string,[string,string]>={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
      const asset=names[u.pathname]; if(!asset)return json({error:'Not found'},404);
      return new Response(readFileSync(fileURLToPath(new URL(asset[0],assets))),{headers:{...sharedHeaders,'Content-Type':asset[1]}});
  }
  const server=createServer(async(incoming,outgoing)=>{
    try {
      const chunks:Buffer[]=[];let size=0;
      if(Number(incoming.headers['content-length']??0)>65536){outgoing.writeHead(413);outgoing.end();incoming.resume();return;}
      for await(const chunk of incoming){const b=Buffer.from(chunk);size+=b.length;if(size>65536){outgoing.writeHead(413);outgoing.end();return;}chunks.push(b);}
      const method=incoming.method??'GET';
      const headers=new Headers();for(const [name,value] of Object.entries(incoming.headers)){if(Array.isArray(value))for(const item of value)headers.append(name,item);else if(value!==undefined)headers.set(name,value);}
      const request=new Request(`http://127.0.0.1:${port}${incoming.url??'/'}`,{method,headers,...(!['GET','HEAD'].includes(method)?{body:Buffer.concat(chunks)}:{})});
      const response=await handle(request);outgoing.writeHead(response.status,Object.fromEntries(response.headers));outgoing.end(Buffer.from(await response.arrayBuffer()));
    }catch{if(!outgoing.headersSent)outgoing.writeHead(500,sharedHeaders);outgoing.end();}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
  port=(server.address() as {port:number}).port;
  return {server,url:`http://127.0.0.1:${port}/#${token}`,stop:()=>{server.closeAllConnections();server.close();}};
}
