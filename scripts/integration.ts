// Isolated real OpenCode 1.19.5 backend + deterministic loopback model. Never
// inherits the user's HOME, configuration, API keys or Feishu connection.
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,realpathSync,readdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {createOpencodeClient} from '@opencode-ai/sdk/client';
import {injectedHost} from '../src/host';import {Store} from '../src/store';import {Engine} from '../src/engine';
const root=realpathSync(mkdtempSync(join(tmpdir(),'opencode-workbench-integration-')));const project=join(root,'project');mkdirSync(project,{recursive:true});
let requests=0;
const model=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
  if(!new URL(req.url).pathname.endsWith('/chat/completions'))return Response.json({error:'Fixture endpoint only'},{status:404});
  const body=await req.json() as any;requests++;
  const tool=JSON.stringify(body.messages).includes('fixture-tool-request');
  const data=tool?[
    {choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'call_fixture',type:'function',function:{name:'bash',arguments:JSON.stringify({command:'printf fixture-safe',description:'Controlled fixture command'})}}]},finish_reason:null}]},
    {choices:[{index:0,delta:{},finish_reason:'tool_calls'}]}
  ]:[{choices:[{index:0,delta:{role:'assistant',content:'Fixture completed without external operations.'},finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}];
  const events=data.map(d=>'data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',...d})+'\n\n').join('')+'data: [DONE]\n\n';
  return new Response(events,{headers:{'Content-Type':'text/event-stream'}});
}});
const config=join(root,'config','opencode');mkdirSync(config,{recursive:true});
const plugin=pathToFileURL(resolve('dist/plugin.js')).href;
writeFileSync(join(config,'opencode.json'),JSON.stringify({plugin:[plugin],model:'fixture/mock',permission:{'*':'ask',edit:'deny'},provider:{fixture:{npm:'@ai-sdk/openai-compatible',name:'Local fixture',options:{baseURL:`http://127.0.0.1:${model.port}/v1`,apiKey:'fixture-only'},models:{mock:{name:'Fixture',limit:{context:8192,output:1024}}}}}}));
const env:Record<string,string>={PATH:process.env.PATH??'/usr/bin:/bin',HOME:join(root,'home'),XDG_CONFIG_HOME:join(root,'config'),XDG_DATA_HOME:join(root,'data'),XDG_CACHE_HOME:join(root,'cache'),XDG_STATE_HOME:join(root,'state'),TMPDIR:tmpdir(),OPENCODE_DISABLE_DEFAULT_PLUGINS:'true',OPENCODE_DISABLE_MODELS_FETCH:'true',OPENCODE_SERVER_PASSWORD:'fixture-private-password',OPENCODE_SERVER_USERNAME:'fixture'};
if(process.platform==='win32')Object.assign(env,{SystemRoot:process.env.SystemRoot??process.env.SYSTEMROOT??'',WINDIR:process.env.WINDIR??'',COMSPEC:process.env.COMSPEC??'',USERPROFILE:env.HOME,APPDATA:join(root,'appdata'),LOCALAPPDATA:join(root,'localappdata'),TEMP:tmpdir(),TMP:tmpdir()});
mkdirSync(env.HOME,{recursive:true});
const binary=process.env.WORKBENCH_OPENCODE_BIN || resolve(`node_modules/opencode-${process.platform==='win32'?'windows':process.platform}-${process.arch}/bin/opencode${process.platform==='win32'?'.exe':''}`);
if(!existsSync(binary))throw new Error('Set WORKBENCH_OPENCODE_BIN to the pinned 1.19.5 test binary for your platform');
async function startBackend() {
  const process=Bun.spawn([binary,'serve','--port','0','--hostname','127.0.0.1'],{cwd:project,env,stdout:'pipe',stderr:'pipe'});
  let output='';
  void (async()=>{for await(const chunk of process.stdout)output+=new TextDecoder().decode(chunk);})();
  void (async()=>{for await(const _chunk of process.stderr){/* fixture logs intentionally withheld */}})();
  for(let i=0;i<600;i++){const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match)return {process,url:match[0]};await Bun.sleep(50);}
  process.kill('SIGKILL');throw new Error('Isolated backend failed to start');
}
const evidence:Record<string,unknown>={version:'1.19.5',isolated:true,usesRealCredentials:false,model:'loopback fixture',feishuMessagesSent:0};
const stage=(value:string)=>{evidence.stage=value;console.log('Integration stage: '+value);};
stage('backend-start');let launched=await startBackend();
const watchdog=setTimeout(()=>{evidence.success=false;evidence.error='Integration timeout at '+evidence.stage;mkdirSync('artifacts',{recursive:true});writeFileSync('artifacts/opencode-integration.json',JSON.stringify(evidence,null,2)+'\n');launched.process.kill('SIGKILL');model.stop(true);console.error(evidence.error);process.exit(1);},180000);
let store:Store|undefined,engine:Engine|undefined;
try{
  const headers={Authorization:'Basic '+Buffer.from('fixture:fixture-private-password').toString('base64')};
  const client=createOpencodeClient({baseUrl:launched.url,headers});const host=injectedHost({client,directory:project});
  stage('configuration');const c=await client.config.get({query:{directory:project}});if(c.error)throw new Error('config failed');
  const tools=await client.tool.ids({query:{directory:project}});
  evidence.pluginLoaded=Array.isArray(tools.data) && tools.data.includes('open_task_manager');
  if(!evidence.pluginLoaded)throw new Error('Real backend did not register open_task_manager');
  stage('session-create');const s=await host.create('Workbench integration fixture');
  const session=await client.session.get({path:{id:s},query:{directory:project}});
  evidence.sessionPermissions=(session.data as any)?.permission;
  const permissions=(session.data as any)?.permission;if(!Array.isArray(permissions)||!permissions.some((r:any)=>r.permission==='*'&&r.action==='ask'))throw new Error('Backend did not persist ask permissions');
  stage('completion');await host.submit(s,'fixture-only completion');
  let status='';for(let i=0;i<80;i++){await Bun.sleep(200);status=(await host.inspect(s)).status;if(['succeeded','failed'].includes(status))break;}
  evidence.completionStatus=status;if(status!=='succeeded')throw new Error('Fixture completion not successful: '+status);
  store=new Store(join(root,'engine.sqlite'));engine=new Engine(store,host);await engine.start();
  const task=store.save({name:'Approval fixture',prompt:'fixture-tool-request',timezone:'UTC',schedule:{kind:'interval',minutes:60},enabled:false,misfire:'skip'});
  stage('approval');const eventAbort=new AbortController();
  const eventStream=await client.event.subscribe({query:{directory:project},signal:eventAbort.signal});let stopped=false;
  const events=(async()=>{for await(const e of eventStream.stream){if(stopped)break;await engine!.event(e);}})().catch(()=>{});
  engine.runNow(task.id,'integration-approval');await Promise.all([...engine.pending]);
  for(let i=0;i<80;i++){await Bun.sleep(200);if(store.runs()[0].status==='waiting_approval')break;}
  evidence.approvalStatus=store.runs()[0].status;if(evidence.approvalStatus!=='waiting_approval')throw new Error('Real tool permission did not enter waiting_approval');
  await engine.cancel(store.runs()[0].id);evidence.cancelStatus=store.runs()[0].status;if(evidence.cancelStatus!=='interrupted')throw new Error('Abort status not reconciled');stopped=true;eventAbort.abort();
  // Persist a completed session as an in-flight plugin run, then restart the
  // actual backend. This exercises plugin initialization and recovery re-entry.
  stage('restart');await engine.stop();store.close();store=undefined;engine=undefined;
  // Use the database actually created by this isolated host. Windows may
  // canonicalize a temp profile's DOS 8.3 alias differently across runtimes;
  // predicting a directory hash can inject the recovery fixture into a second,
  // unused database and falsely report that recovery never ran.
  const stateRoot=join(root,'state','opencode-workbench');
  const databases=readdirSync(stateRoot,{withFileTypes:true}).filter(e=>e.isDirectory()&&existsSync(join(stateRoot,e.name,'tasks.sqlite')));
  evidence.recoveryDatabaseCount=databases.length;
  if(databases.length!==1)throw new Error('Expected exactly one isolated host task database');
  const pluginPath=join(stateRoot,databases[0].name,'tasks.sqlite');
  const recoveryStore=new Store(pluginPath);
  const recoveryTask=recoveryStore.save({name:'Recovery fixture',prompt:'fixture-only completion',timezone:'UTC',schedule:{kind:'interval',minutes:60},enabled:false,misfire:'skip'});
  const recoveryRun=recoveryStore.claim(recoveryTask,'recovery-fixture','submitted')!;recoveryRun.sessionID=s;recoveryStore.putRun(recoveryRun);recoveryStore.close();
  launched.process.kill('SIGKILL');await launched.process.exited;launched=await startBackend();
  stage('restart-tools');const after=createOpencodeClient({baseUrl:launched.url,headers});const afterTools=await after.tool.ids({query:{directory:project}});
  if(!afterTools.data?.includes('open_task_manager'))throw new Error('Plugin failed registration after restart');
  const observed=new Store(pluginPath);let recovered='';
  for(let i=0;i<180;i++){await Bun.sleep(200);recovered=observed.run(recoveryRun.id)?.status??'';if(recovered==='succeeded')break;}
  observed.close();evidence.restartRecoveredStatus=recovered;if(recovered!=='succeeded')throw new Error('Plugin restart recovery failed');
  evidence.modelRequests=requests;if(requests!==2)throw new Error('Restart unexpectedly re-submitted model work');stage('complete');evidence.success=true;
}catch(e){evidence.success=false;evidence.error=(e as Error).message;process.exitCode=1;}
finally{
  clearTimeout(watchdog);if(engine)await engine.stop();store?.close();launched.process.kill('SIGKILL');await launched.process.exited;model.stop(true);
  mkdirSync('artifacts',{recursive:true});writeFileSync('artifacts/opencode-integration.json',JSON.stringify(evidence,null,2)+'\n');
  // Fixtures are intentionally retained in OS temporary storage for debugging,
  // never in Git. Print only sanitized summary, not backend auth or directories.
  console.log(JSON.stringify(evidence,null,2));
}
