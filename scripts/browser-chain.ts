import assert from 'node:assert/strict';
import {createServer} from 'node:http';import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {pathToFileURL} from 'node:url';
import {createOpencodeClient} from '@opencode-ai/sdk/client';
import {browserRPC} from '../tests/fixtures/browser-rpc';
import {fixture} from '../tests/fixtures/lark-mock';
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const root=realpathSync(mkdtempSync(join(tmpdir(),'workbench-browser-chain-'))),project=join(root,'project');mkdirSync(project);
const browser=await browserRPC();let phase=0,approvals=0,ownedSession='',modelError='',child:ChildProcess|undefined,hooks:any;
const evidence:any={version:'1.19.5',realOpenCode:true,realHeadlessChromium:true,feishuTransport:'in-memory SDK mock',browserSkillTransport:'test-only CLI protocol fixture',realCredentialsUsed:false,realFeishuMessagesSent:0};
function payloads(value:any,out:any[]=[]):any[]{if(typeof value==='string'){try{payloads(JSON.parse(value),out);}catch{}}else if(Array.isArray(value))for(const v of value)payloads(v,out);else if(value&&typeof value==='object'){if(value.handle||value.context_id)out.push(value);for(const v of Object.values(value))payloads(v,out);}return out;}
const model=createServer(async(req,res)=>{
  try{
    const chunks:Buffer[]=[];for await(const c of req)chunks.push(Buffer.from(c));const body=JSON.parse(Buffer.concat(chunks).toString());
    if(phase===0){assert.ok(JSON.stringify(body.messages).includes('Synthetic quoted browser task'),'Direct quoted card text did not reach OpenCode');evidence.quotedCardTextObserved=true;}
    const outputs=payloads(body.messages.filter((m:any)=>m.role==='tool'));
    const handle=outputs.find((v:any)=>v.handle)?.handle,state=[...outputs].reverse().find((v:any)=>v.context_id);
    const steps:any[]=[{action:'start',intent:'Run only the authorized controlled browser fixture'},{action:'navigate',handle,url:browser.origin+'/',intent:'Open controlled fixture'},{action:'sync',handle},{action:'fill',handle,context:state?.context_id,ref:'@e1',value:'fixture-only',intent:'Fill the observed Query with synthetic data'},{action:'sync',handle},{action:'click',handle,context:state?.context_id,ref:'@e2',intent:'Activate the observed local verification button'},{action:'sync',handle},{action:'stop',handle}];
    let first:any,last:any;
    if(phase<steps.length){const args=steps[phase];if(phase>0&&!handle)throw new Error('Model fixture did not receive the tool handle: '+JSON.stringify(body.messages.filter((m:any)=>m.role==='tool')).slice(0,4000));if([3,5].includes(phase)&&!state?.context_id)throw new Error('Model fixture did not receive current context');if(phase===7&&!state?.observation?.text?.includes('Verified browser fixture: fixture-only'))throw new Error('Browser result was not observed');first={role:'assistant',tool_calls:[{index:0,id:`fixture-call-${phase}`,type:'function',function:{name:'workbench_browser',arguments:JSON.stringify(args)}}]};last='tool_calls';}
    else{first={role:'assistant',content:'Verified browser fixture: fixture-only. The owned browser session was stopped.'};last='stop';}
    phase++;
    const chunksOut=[{choices:[{index:0,delta:first,finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:last}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}];
    res.writeHead(200,{'content-type':'text/event-stream'});res.end(chunksOut.map(v=>'data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',...v})+'\n\n').join('')+'data: [DONE]\n\n');
  }catch(e){modelError=(e as Error).message;res.writeHead(500);res.end('{}');}
});
await new Promise<void>(r=>model.listen(0,'127.0.0.1',r));const modelPort=(model.address() as any).port;
const config=join(root,'config','opencode');mkdirSync(config,{recursive:true});
const browserConfig=join(root,'browser.json'),feishuConfig=join(root,'feishu-fixture.json');
writeFileSync(browserConfig,JSON.stringify({enabled:true,directory:project,bskPath:resolve(`.data/bsk-fixture${process.platform==='win32'?'.exe':''}`),browser:'fixture-browser',allowedOrigins:[browser.origin],actions:['navigate','click','fill','press']}));
writeFileSync(feishuConfig,JSON.stringify({appId:'fixture-only',appSecret:'fixture-only',directory:project,allowedSenderIDs:['fixture-user'],allowedChatIDs:['fixture-chat'],pollInterval:100,stablePolls:2,timeout:60000}));
writeFileSync(join(config,'opencode.json'),JSON.stringify({plugin:[pathToFileURL(resolve('adapters/browser/plugin.js')).href],model:'fixture/mock',permission:{'*':'ask',bash:'deny',edit:'deny'},provider:{fixture:{npm:'@ai-sdk/openai-compatible',name:'Isolated fixture',options:{baseURL:`http://127.0.0.1:${modelPort}/v1`,apiKey:'fixture-only'},models:{mock:{name:'Fixture',limit:{context:32000,output:2048}}}}}}));
const env:NodeJS.ProcessEnv={PATH:process.env.PATH,HOME:join(root,'home'),XDG_CONFIG_HOME:join(root,'config'),XDG_DATA_HOME:join(root,'data'),XDG_CACHE_HOME:join(root,'cache'),XDG_STATE_HOME:join(root,'state'),TMPDIR:tmpdir(),OPENCODE_DISABLE_DEFAULT_PLUGINS:'true',OPENCODE_DISABLE_MODELS_FETCH:'true',OPENCODE_SERVER_PASSWORD:'fixture-only',OPENCODE_SERVER_USERNAME:'fixture',OPENCODE_WORKBENCH_BROWSER_CONFIG:browserConfig,WORKBENCH_BROWSER_FIXTURE_RPC:browser.origin,WORKBENCH_BROWSER_FIXTURE_TOKEN:browser.token};
if(process.platform==='win32')Object.assign(env,{SystemRoot:process.env.SystemRoot,COMSPEC:process.env.COMSPEC,USERPROFILE:env.HOME,APPDATA:join(root,'appdata'),LOCALAPPDATA:join(root,'localappdata'),TEMP:tmpdir(),TMP:tmpdir()});mkdirSync(env.HOME!,{recursive:true});
const binary=process.env.WORKBENCH_OPENCODE_BIN||resolve(`node_modules/opencode-${process.platform==='win32'?'windows':process.platform}-${process.arch}/bin/opencode${process.platform==='win32'?'.exe':''}`);
if(!existsSync(binary))throw new Error('Pinned OpenCode fixture binary is missing');
const abort=new AbortController();const watchdog=setTimeout(()=>{console.error('Browser chain fixture timed out');child?.kill('SIGKILL');process.exit(1);},240000);
try{
  console.log('Browser chain stage: isolated backend');child=spawn(binary,['serve','--port','0','--hostname','127.0.0.1'],{cwd:project,env,stdio:['ignore','pipe','pipe'],windowsHide:true});let output='';child.stdout!.on('data',c=>{output+=String(c);});child.stderr!.resume();
  let url='';for(let i=0;i<600;i++){url=output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]??'';if(url)break;await delay(50);}assert.ok(url,'Backend did not start');
  const headers={Authorization:'Basic '+Buffer.from('fixture:fixture-only').toString('base64')},client=createOpencodeClient({baseUrl:url,headers});
  const tools=await client.tool.ids({query:{directory:project}});assert.ok(tools.data?.includes('workbench_browser'),'Browser tool was not registered');
  const create=client.session.create.bind(client.session);(client.session as any).create=async(options:any)=>{const r=await create(options);if(r.data)ownedSession=r.data.id;return r;};
  process.env.XDG_STATE_HOME=env.XDG_STATE_HOME;process.env.OPENCODE_WORKBENCH_FEISHU_CONFIG=feishuConfig;process.env.OPENCODE_WORKBENCH_FEISHU_TELEMETRY='0';process.env.OPENCODE_SERVER_PASSWORD='fixture-only';process.env.OPENCODE_SERVER_USERNAME='fixture';
  const bridge=await import(pathToFileURL(resolve('.data/feishu/dist/index.fixture.js')).href);
  hooks=await bridge.FeishuPlugin({client,directory:project,worktree:project,project:{},serverUrl:new URL(url)});assert.ok(fixture.ready);
  const stream=await client.event.subscribe({query:{directory:project},signal:abort.signal});
  void(async()=>{for await(const raw of stream.stream){const event=raw as any;await hooks.event?.({event});if(event.type==='permission.asked'){
    const p:any=event.properties;if(p.sessionID!==ownedSession||p.permission!=='workbench_browser')throw new Error('Unexpected permission outside the controlled browser task');
    for(let n=0;n<80&&!fixture.calls.some((c:any)=>JSON.stringify(c.args).includes(p.id));n++)await delay(50);
    assert.ok(fixture.calls.some((c:any)=>JSON.stringify(c.args).includes(p.id)),'Feishu permission card was not produced');
    const callback={action:{tag:'button',value:{action:'permission_reply',requestId:p.id,sessionId:p.sessionID,reply:'once'}},context:{open_chat_id:'fixture-chat',open_message_id:'fixture-permission-card'},operator:{open_id:'unapproved-fixture-user'}};
    const denied=await fixture.handlers['card.action.trigger'](callback);assert.equal(denied.toast?.type,'warning');
    callback.operator.open_id='fixture-user';const originalID=callback.action.value.requestId;callback.action.value.requestId='unregistered-fixture-request';const forged=await fixture.handlers['card.action.trigger'](callback);assert.equal(forged.toast?.type,'warning');callback.action.value.requestId=originalID;await fixture.handlers['card.action.trigger'](callback);const replay=await fixture.handlers['card.action.trigger'](callback);assert.equal(replay.toast?.type,'warning');approvals++;
  }}})().catch(e=>{if(!abort.signal.aborted)modelError=e.message;});
  console.log('Browser chain stage: simulated Feishu input, real browser tool execution');
  await fixture.handlers['im.message.receive_v1']({sender:{sender_id:{open_id:'unapproved-fixture-user'}},message:{chat_id:'fixture-chat',message_id:'unapproved-input',chat_type:'p2p',message_type:'text',content:JSON.stringify({text:'This must not reach OpenCode'})}});
  await delay(100);assert.equal(ownedSession,'');assert.equal(phase,0);
  await fixture.handlers['im.message.receive_v1']({sender:{sender_id:{open_id:'fixture-user'}},message:{chat_id:'fixture-chat',message_id:'fixture-input',parent_id:'fixture-parent',root_id:'fixture-parent',chat_type:'p2p',message_type:'text',content:JSON.stringify({text:'Run the workbench-browser-chain-fixture and return the verified result to this conversation.'})}});
  let delivered=false;
  for(let i=0;i<1400;i++){if(modelError)throw new Error(modelError);delivered=phase>=9&&fixture.calls.some((c:any)=>c.path.includes('cardElement.content')&&JSON.stringify(c.args).includes('Verified browser fixture: fixture-only'));if(delivered&&browser.sessions.size===0)break;await delay(100);}
  assert.ok(delivered,'Verified result was not delivered through the Feishu transport');assert.equal(browser.sessions.size,0);assert.ok(approvals>=4);
  const destinations=fixture.calls.flatMap((c:any)=>c.args.map((a:any)=>a?.data?.receive_id).filter(Boolean));assert.ok(destinations.length);assert.ok(destinations.every((id:string)=>id==='fixture-chat'));
  Object.assign(evidence,{nativePermissionCards:approvals,modelRequests:phase,browserActions:browser.trace.map(t=>t.action),ownedSessionsRemaining:0,feishuResultObserved:true,originalMappedDestinationOnly:true,success:true});
}catch(e){Object.assign(evidence,{success:false,error:(e as Error).message,phase,approvals,browserActions:browser.trace.map(t=>t.action)});process.exitCode=1;}
finally{clearTimeout(watchdog);abort.abort();await hooks?.dispose?.();child?.kill('SIGKILL');if(child&&child.exitCode===null&&child.signalCode===null)await new Promise<void>(r=>child!.once('close',()=>r()));await browser.close();model.closeAllConnections();model.close();mkdirSync('artifacts',{recursive:true});writeFileSync('artifacts/browser-chain.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));}
