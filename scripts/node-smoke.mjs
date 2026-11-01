import assert from 'node:assert/strict';import {mkdtempSync,rmSync,mkdirSync,writeFileSync,copyFileSync,realpathSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';import childProcess from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import {EventEmitter} from 'node:events';
const directory=mkdtempSync(join(tmpdir(),'workbench node 中文-'));process.env.XDG_STATE_HOME=join(directory,'state');
const original=childProcess.spawn;let pageURL='';let submissions=0;
childProcess.spawn=(_cmd,args)=>{pageURL=args.at(-1);const fake=new EventEmitter();queueMicrotask(()=>fake.emit('exit',0));return fake;};syncBuiltinESMExports();
let hooks;
try{
  const {TaskManager}=await import('../dist/plugin.js');
  process.env.OPENCODE_WORKBENCH_FEISHU_CONFIG=join(directory,'no-feishu-config.json');
  const {FeishuDesktop}=await import('../adapters/feishu/plugin.js');assert.deepEqual(await FeishuDesktop({directory}),{});
  // Exercise the exact compiled optional loader with a local stub, never a bot.
  // A Windows drive path passed directly to import() would fail this test.
  const sandbox=join(directory,'feishu fixture');const entry=join(sandbox,'adapters','feishu','plugin.js');const upstream=join(sandbox,'.data','feishu','dist');
  mkdirSync(join(sandbox,'adapters','feishu'),{recursive:true});mkdirSync(upstream,{recursive:true});writeFileSync(join(sandbox,'package.json'),JSON.stringify({type:'module'}));copyFileSync(new URL('../adapters/feishu/plugin.js',import.meta.url),entry);
  writeFileSync(join(upstream,'index.desktop.js'),'export const FeishuPlugin = async () => ({fixtureOnly: true});\n');
  const config=join(sandbox,'fixture.json');writeFileSync(config,JSON.stringify({directory}));process.env.OPENCODE_WORKBENCH_FEISHU_CONFIG=config;
  const {FeishuDesktop:FixtureFeishu}=await import(pathToFileURL(entry).href);assert.deepEqual(await FixtureFeishu({directory}),{fixtureOnly:true});
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
  const manifest=JSON.stringify({version:1,sources:[{kind:'plugin',id:'node-fixture-source',tasks:[{id:'old-node-task',project:realpathSync(directory),name:'Imported Node fixture',prompt:'Read separate import fixture only',timezone:'UTC',schedule:{kind:'interval',minutes:60},enabled:true}]}]});
  const preview=JSON.parse(await hooks.tool.import_scheduled_tasks.execute({manifest},{sessionID:'fixture-agent'}));assert.equal(preview.counts.ready,1);assert.equal((await (await fetch(u.origin+'/api/state',{headers})).json()).tasks.length,1);
  const result=JSON.parse(await hooks.tool.import_scheduled_tasks.execute({manifest,dryRun:false,preview:preview.preview},{sessionID:'fixture-agent'}));assert.equal(result.imported.length,1);
  const retry=JSON.parse(await hooks.tool.import_scheduled_tasks.execute({manifest,dryRun:false,preview:preview.preview},{sessionID:'fixture-agent'}));assert.equal(retry.imported.length,0);
  const importedState=await (await fetch(u.origin+'/api/state',{headers})).json();const imported=importedState.tasks.find(t=>t.id===result.imported[0]);assert.equal(imported.enabled,false);assert.equal(imported.origin.executor,'unassigned');assert.equal(submissions,1);
  console.log(JSON.stringify({runtime:'node',toolRegistered:true,sqliteCRUD:true,httpAuth:true,submittedOnce:true,terminalStatus:'succeeded'}));
}finally{await hooks?.dispose();childProcess.spawn=original;syncBuiltinESMExports();rmSync(directory,{recursive:true});}
