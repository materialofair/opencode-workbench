import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import childProcess from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import {EventEmitter} from 'node:events';
const directory=mkdtempSync(join(tmpdir(),'workbench-node-smoke-'));process.env.XDG_STATE_HOME=join(directory,'state');
const original=childProcess.spawn;let pageURL='';let submissions=0;
childProcess.spawn=(_cmd,args)=>{pageURL=args.at(-1);const fake=new EventEmitter();queueMicrotask(()=>fake.emit('exit',0));return fake;};syncBuiltinESMExports();
let hooks;
try{
  const {TaskManager}=await import('../dist/plugin.js');
  process.env.OPENCODE_WORKBENCH_FEISHU_CONFIG=join(directory,'no-feishu-config.json');
  const {FeishuDesktop}=await import('../adapters/feishu/plugin.js');assert.deepEqual(await FeishuDesktop({directory}),{});
  const client={config:{get:async()=>({data:{permission:{edit:'deny'}}})},app:{agents:async()=>({data:[{name:'build',permission:[]}]})},session:{create:async()=>({data:{id:'node-fixture'}}),promptAsync:async()=>{submissions++;return{};},status:async()=>({data:{}}),messages:async()=>({data:[{info:{role:'assistant',sessionID:'node-fixture',time:{completed:Date.now()},finish:'stop'}}]}),abort:async()=>({})}};
  hooks=await TaskManager({client,directory,worktree:directory,project:{}});
  await hooks.tool.open_task_manager.execute({},{sessionID:'launch-fixture'});assert.ok(pageURL.startsWith('http://127.0.0.1:'));
  const u=new URL(pageURL),token=u.hash.slice(1),headers={Authorization:`Bearer ${token}`,'X-Task-CSRF':token,Origin:u.origin,'Content-Type':'application/json'};
  assert.equal((await fetch(u.origin+'/api/state')).status,401);
  const created=await fetch(u.origin+'/api/tasks',{method:'POST',headers,body:JSON.stringify({name:'Node smoke',prompt:'Fixture only',timezone:'UTC',schedule:{kind:'interval',minutes:1},enabled:false,misfire:'skip'})});assert.equal(created.status,201);const task=await created.json();
  const run=await fetch(u.origin+`/api/tasks/${task.id}/run`,{method:'POST',headers:{...headers,'Idempotency-Key':'node-fixture-key-123'}});assert.equal(run.status,202);
  for(let i=0;i<40&&submissions===0;i++)await new Promise(r=>setTimeout(r,25));assert.equal(submissions,1);
  await hooks.event({event:{type:'session.idle',properties:{sessionID:'node-fixture'}}});
  const state=await (await fetch(u.origin+'/api/state',{headers})).json();assert.equal(state.runs[0].status,'succeeded');
  console.log(JSON.stringify({runtime:'node',toolRegistered:true,sqliteCRUD:true,httpAuth:true,submittedOnce:true,terminalStatus:'succeeded'}));
}finally{await hooks?.dispose();childProcess.spawn=original;syncBuiltinESMExports();rmSync(directory,{recursive:true});}
