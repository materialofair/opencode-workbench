import {test,expect} from 'bun:test';
import {Store} from '../src/store';
import {Engine} from '../src/engine';
import type {Host,Snapshot} from '../src/host';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const task={name:'read only',prompt:'Summarize only',timezone:'UTC',schedule:{kind:'interval' as const,minutes:1},enabled:true,misfire:'skip' as const};
function fixture(path=':memory:'){
  let now=Date.parse('2026-11-01T00:00Z'),created=0,submitted=0;
  let snapshot:Snapshot={status:'running'};
  const host:Host={async create(){return `session-${++created}`;},async submit(){submitted++;},async inspect(){return snapshot;},async abort(){}};
  const store=new Store(path);const engine=new Engine(store,host,2,()=>now);
  return {store,engine,host,advance:(ms:number)=>now+=ms,setSnapshot:(s:Snapshot)=>snapshot=s,counts:()=>({created,submitted}),now:()=>now};
}
async function flush(e:Engine){await Promise.all([...e.pending]);}
test('scheduled tick unique, manual key idempotent, per-task overlap skipped',async()=>{
  const f=fixture();const t=f.store.save(task,undefined,undefined,f.now());
  f.advance(60000);await f.engine.tick();await flush(f.engine);await f.engine.tick();
  expect(f.counts().submitted).toBe(1);expect(f.store.runs()[0].status).toBe('running');
  f.engine.runNow(t.id,'repeat-key');f.engine.runNow(t.id,'repeat-key');expect(f.store.runs().length).toBe(2);expect(f.counts().submitted).toBe(1);
  await f.engine.stop();f.store.close();
});
test('async acceptance never becomes success without terminal evidence, approval preserved',async()=>{
  const f=fixture();const t=f.store.save(task,undefined,undefined,f.now());
  const r=f.engine.runNow(t.id,'test-key')!;await flush(f.engine);expect(f.store.runs()[0].status).toBe('submitted');
  await f.engine.event({type:'permission.asked',properties:{sessionID:'session-1',id:'request-1'}});
  await f.engine.tick();expect(f.store.runs()[0].status).toBe('waiting_approval');
  await f.engine.event({type:'permission.replied',properties:{sessionID:'session-1',reply:'once'}});expect(f.store.runs()[0].status).toBe('running');
  f.setSnapshot({status:'succeeded'});await f.engine.event({type:'session.idle',properties:{sessionID:'session-1'}});expect(f.store.runs()[0].status).toBe('succeeded');
  await f.engine.stop();f.store.close();
});
test('misfires skip or coalesce once, never replay every missed interval',async()=>{
  const f=fixture();f.store.save(task,undefined,undefined,f.now());f.store.save({...task,name:'latest',misfire:'latest'},undefined,undefined,f.now());
  f.advance(8*3600000+4000);await f.engine.tick();await flush(f.engine);expect(f.counts().submitted).toBe(1);expect(f.store.runs().some(r=>r.status==='skipped')).toBe(true);
  await f.engine.tick();expect(f.counts().submitted).toBe(1);await f.engine.stop();f.store.close();
});
test('durable state restart reconciles active session without submitting again',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'workbench-'));const path=join(dir,'tasks.sqlite');
  const a=fixture(path);const t=a.store.save(task,undefined,undefined,a.now());a.engine.runNow(t.id,'first');await flush(a.engine);await a.engine.stop();a.store.close();
  const b=fixture(path);b.setSnapshot({status:'succeeded'});await b.engine.tick();expect(b.counts().submitted).toBe(0);expect(b.store.runs()[0].status).toBe('succeeded');await b.engine.stop();b.store.close();rmSync(dir,{recursive:true});
});
test('lost submission ack is uncertain and never retried',async()=>{
  const f=fixture();f.host.submit=async()=>{throw new Error('network lost after send');};const t=f.store.save(task,undefined,undefined,f.now());f.engine.runNow(t.id,'first');await flush(f.engine);
  expect(f.store.runs()[0].status).toBe('uncertain');await f.engine.tick();expect(f.counts().created).toBe(1);await f.engine.stop();f.store.close();
});
test('global concurrency and two process database lease',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'workbench-'));const path=join(dir,'tasks.sqlite');const a=fixture(path),b=fixture(path);
  for(let i=0;i<3;i++) {const t=a.store.save({...task,name:`task-${i}`},undefined,undefined,a.now());a.engine.runNow(t.id,`manual-${i}`);}
  await flush(a.engine);expect(a.counts().submitted).toBe(2);expect(a.store.runs().filter(r=>r.status==='skipped').length).toBe(1);
  await b.engine.tick();expect(b.engine.leader).toBe(false);expect(()=>b.engine.runNow(a.store.tasks()[0].id,'foreign')).toThrow();
  await a.engine.stop();a.store.close();await b.engine.tick();expect(b.engine.leader).toBe(true);await b.engine.stop();b.store.close();rmSync(dir,{recursive:true});
});
test('stale edits rejected, pause resumes without old backfill, run snapshot survives delete',()=>{
  const f=fixture();const t=f.store.save(task,undefined,undefined,f.now());const paused=f.store.save({...t,enabled:false},t.id,t.revision,f.now());expect(paused.next).toBeNull();expect(()=>f.store.save(t,t.id,t.revision,f.now())).toThrow();
  f.advance(3600000);const resumed=f.store.save({...paused,enabled:true},t.id,paused.revision,f.now());expect(resumed.next).toBe(f.now()+60000);
  f.store.claim(resumed,'test','succeeded');f.store.delete(t.id);expect(f.store.runs()[0].taskName).toBe(task.name);f.store.close();
});
test('slow reconciliation cannot overwrite a newly received approval event',async()=>{
  const f=fixture();const t=f.store.save(task,undefined,undefined,f.now());f.engine.runNow(t.id,'first');await flush(f.engine);
  let release!:(v:Snapshot)=>void;f.host.inspect=()=>new Promise<Snapshot>(r=>{release=r;});
  const tick=f.engine.tick();await Promise.resolve();await f.engine.event({type:'permission.asked',properties:{sessionID:'session-1'}});release({status:'running'});await tick;
  expect(f.store.runs()[0].status).toBe('waiting_approval');await f.engine.stop();f.store.close();
});
test('abort error event during host cancellation ends as user-interrupted',async()=>{
  const f=fixture();const t=f.store.save(task,undefined,undefined,f.now());const r=f.engine.runNow(t.id,'first')!;await flush(f.engine);
  f.host.abort=async()=>{await f.engine.event({type:'session.error',properties:{sessionID:'session-1'}});};await f.engine.cancel(r.id);expect(f.store.runs()[0].status).toBe('interrupted');await f.engine.stop();f.store.close();
});
