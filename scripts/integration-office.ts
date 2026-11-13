// Real OpenCode backend, isolated HOME and synthetic loopback model; never uses user credentials.
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,realpathSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {createOpencodeClient} from '@opencode-ai/sdk/client';
const root=realpathSync(mkdtempSync(join(tmpdir(),'office-host-fixture-'))),project=join(root,'project');mkdirSync(project);
let requests=0;
const spec=JSON.parse(readFileSync('office/examples/dashboard.json','utf8'));
const model=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
 if(!new URL(req.url).pathname.endsWith('/chat/completions'))return new Response('fixture only',{status:404});
 const body=await req.json() as any;requests++;const done=body.messages.some((m:any)=>m.role==='tool');
 const delta=done?{role:'assistant',content:'Local fixture artifact completed.'}:{role:'assistant',tool_calls:[{index:0,id:'office_fixture_call',type:'function',function:{name:'office_render_html',arguments:JSON.stringify({spec:JSON.stringify(spec),output:'fixture.html'})}}]};
 return new Response('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason:null}]})+'\n\ndata: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:{},finish_reason:done?'stop':'tool_calls'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
}});
const config=join(root,'config','opencode');mkdirSync(config,{recursive:true});mkdirSync(join(root,'home'));
writeFileSync(join(config,'opencode.json'),JSON.stringify({plugin:[pathToFileURL(resolve('adapters/office/plugin.js')).href],model:'fixture/mock',permission:{'*':'deny',office_render_html:'allow',edit:'allow'},provider:{fixture:{npm:'@ai-sdk/openai-compatible',name:'Loopback fixture',options:{baseURL:`http://127.0.0.1:${model.port}/v1`,apiKey:'fixture-only'},models:{mock:{name:'Fixture',limit:{context:16384,output:8192}}}}}}));
const binary=resolve(`node_modules/opencode-${process.platform==='win32'?'windows':process.platform}-${process.arch}/bin/opencode${process.platform==='win32'?'.exe':''}`);
if(!existsSync(binary))throw new Error('Pinned OpenCode test binary missing');
const env={PATH:process.env.PATH??'',HOME:join(root,'home'),XDG_CONFIG_HOME:join(root,'config'),XDG_DATA_HOME:join(root,'data'),XDG_CACHE_HOME:join(root,'cache'),XDG_STATE_HOME:join(root,'state'),OPENCODE_DISABLE_DEFAULT_PLUGINS:'true',OPENCODE_DISABLE_MODELS_FETCH:'true',OPENCODE_SERVER_PASSWORD:'fixture-private-password',OPENCODE_SERVER_USERNAME:'fixture'};
const child=Bun.spawn([binary,'serve','--port','0','--hostname','127.0.0.1'],{cwd:project,env,stdout:'pipe',stderr:'pipe'});let output='';void(async()=>{for await(const c of child.stdout)output+=new TextDecoder().decode(c)})();void(async()=>{for await(const c of child.stderr){/* isolated logs omitted */}})();
const evidence:any={real_backend:true,real_model:false,uses_user_credentials:false,scope:'synthetic temporary project only'};
const timeout=setTimeout(()=>child.kill('SIGKILL'),90000);
try{
 let url='';for(let i=0;i<600;i++){url=output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]??'';if(url)break;await Bun.sleep(50);}if(!url)throw new Error('Backend start timeout');
 const client=createOpencodeClient({baseUrl:url,headers:{Authorization:'Basic '+Buffer.from('fixture:fixture-private-password').toString('base64')}});
 const ids=await client.tool.ids({query:{directory:project}});evidence.registered_tools=ids.data?.filter(x=>x.startsWith('office_'));if(evidence.registered_tools?.length!==4)throw new Error('Expected four office tools');
 const session=await client.session.create({query:{directory:project},body:{title:'Office isolated fixture'}});const id=session.data?.id;if(!id)throw new Error('Session creation failed');
 const result=await client.session.prompt({path:{id},query:{directory:project},body:{parts:[{type:'text',text:'Run the synthetic local HTML generation fixture once.'}]}});
 evidence.artifact_created=existsSync(join(project,'fixture.html'));evidence.model_requests=requests;evidence.success=evidence.artifact_created&&requests===2;
 if(!evidence.success)throw new Error('Real host tool execution did not complete');
}catch(error){evidence.success=false;evidence.error=String(error);process.exitCode=1;}
finally{clearTimeout(timeout);child.kill('SIGKILL');await child.exited;model.stop(true);mkdirSync('office/evidence',{recursive:true});writeFileSync('office/evidence/opencode-host-integration.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));}
