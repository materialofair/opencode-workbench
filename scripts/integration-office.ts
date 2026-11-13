// Real OpenCode backend, isolated HOME and synthetic loopback model; never uses user credentials.
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,realpathSync,readFileSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {executeOffice} from '../adapters/office/plugin.ts';
import {createOpencodeClient} from '@opencode-ai/sdk/client';
const root=realpathSync(mkdtempSync(join(tmpdir(),'office-host-fixture-'))),project=join(root,'project');mkdirSync(project);
let requests=0;
const workflow=process.argv.includes('--workflow'),interactive=process.argv.includes('--interactive');
let sourceEvidence:any=null;
if(workflow)await executeOffice(project,{operation:'generate_excel',output:'source.xlsx',spec:{sheets:[{name:'Revenue',rows:[['Month','Actual','Budget','Variance'],['Jan',120,130,{formula:'=B2-C2',cached:-10}],['Feb',155,150,{formula:'=B3-C3',cached:5}],['Mar',143,150,{formula:'=B4-C4',cached:-7}]]}],charts:[{type:'bar',title:'Revenue source chart',categories:['Jan','Feb','Mar'],series:[{name:'Actual',values:[120,155,143]}]}]}});
const spec=JSON.parse(readFileSync('office/examples/dashboard.json','utf8'));
const model=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
 if(!new URL(req.url).pathname.endsWith('/chat/completions'))return new Response('fixture only',{status:404});
 const body=await req.json() as any;requests++;const tools=body.messages.filter((m:any)=>m.role==='tool');const toolCount=tools.length;const done=toolCount>=(workflow?3:2);
 let name='office_validate_html',args:any={input:'fixture.html',output:'qa-evidence',mode:interactive?'first-party-table':'static'};
 if(!done&&workflow&&toolCount===0){name='office_inspect_excel';args={input:'source.xlsx',options:JSON.stringify({sheets:['Revenue','ChartData1'],max_rows:4,max_cols:4,max_cells:32})};}
 else if(!done&&toolCount===(workflow?1:0)){
  let renderSpec=structuredClone(spec);
  if(workflow){
   const content=tools[0].content;const raw=typeof content==='string'?content:content.filter((x:any)=>x.type==='text').map((x:any)=>x.text).join('');
   const report=JSON.parse(raw).result;const cells=new Map(report.sheets[0].cells.map((c:any)=>[c.cell,c]));
   const rows=[2,3,4].map(row=>[(cells.get('A'+row) as any).value,(cells.get('B'+row) as any).value,(cells.get('C'+row) as any).value]);
   if(JSON.stringify(rows)!==JSON.stringify([['Jan',120,130],['Feb',155,150],['Mar',143,150]]))throw new Error('Workbook tool data did not match independent fixture expectation');
   sourceEvidence={sha256:report.source_sha256,chart_count:report.charts.length,formulas_unverified:report.sheets[0].formulas.every((f:any)=>f.cache_status==='unverified'),rows};
   renderSpec={version:1,scenario:'operations',title:'Workbook-derived revenue review',subtitle:'Synthetic fixture; values read through the real host tool, formula caches not calculated',sections:[{type:'table',title:'Revenue source data',headers:['Month','Actual','Budget'],rows},{type:'chart',chart:{type:'bar',title:'Actual revenue',categories:rows.map(r=>r[0]),series:[{name:'Actual',values:rows.map(r=>r[1])}]}},{type:'text',body:'Source SHA256: '+report.source_sha256+'; formula caches remain unverified.'}]};
  }
  if(interactive)renderSpec.interaction='first-party-table';name='office_render_html';args={spec:JSON.stringify(renderSpec),output:'fixture.html'};
 }
 const delta=done?{role:'assistant',content:'Local fixture artifact completed.'}:{role:'assistant',tool_calls:[{index:0,id:'office_fixture_call_'+toolCount,type:'function',function:{name,arguments:JSON.stringify(args)}}]};
 return new Response('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason:null}]})+'\n\ndata: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:{},finish_reason:done?'stop':'tool_calls'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
}});
const config=join(root,'config','opencode');mkdirSync(config,{recursive:true});mkdirSync(join(root,'home'));
writeFileSync(join(config,'opencode.json'),JSON.stringify({plugin:[pathToFileURL(resolve('adapters/office/plugin.js')).href],model:'fixture/mock',permission:{'*':'deny',office_render_html:'allow',office_inspect_excel:'allow',office_validate_html:'allow',read:'allow',edit:'allow'},provider:{fixture:{npm:'@ai-sdk/openai-compatible',name:'Loopback fixture',options:{baseURL:`http://127.0.0.1:${model.port}/v1`,apiKey:'fixture-only'},models:{mock:{name:'Fixture',limit:{context:16384,output:8192}}}}}}));
const binary=resolve(`node_modules/opencode-${process.platform==='win32'?'windows':process.platform}-${process.arch}/bin/opencode${process.platform==='win32'?'.exe':''}`);
if(!existsSync(binary))throw new Error('Pinned OpenCode test binary missing');
const browserCache=process.env.PLAYWRIGHT_BROWSERS_PATH||(process.platform==='darwin'?join(homedir(),'Library','Caches','ms-playwright'):join(homedir(),'.cache','ms-playwright'));
const env={PLAYWRIGHT_BROWSERS_PATH:browserCache,PATH:process.env.PATH??'',HOME:join(root,'home'),XDG_CONFIG_HOME:join(root,'config'),XDG_DATA_HOME:join(root,'data'),XDG_CACHE_HOME:join(root,'cache'),XDG_STATE_HOME:join(root,'state'),OPENCODE_DISABLE_DEFAULT_PLUGINS:'true',OPENCODE_DISABLE_MODELS_FETCH:'true',OPENCODE_SERVER_PASSWORD:'fixture-private-password',OPENCODE_SERVER_USERNAME:'fixture'};
const child=Bun.spawn([binary,'serve','--port','0','--hostname','127.0.0.1'],{cwd:project,env,stdout:'pipe',stderr:'pipe'});let output='';void(async()=>{for await(const c of child.stdout)output+=new TextDecoder().decode(c)})();void(async()=>{for await(const c of child.stderr){/* isolated logs omitted */}})();
const evidence:any={real_backend:true,real_model:false,uses_user_credentials:false,scope:'synthetic temporary project only',workflow,interactive};
const timeout=setTimeout(()=>child.kill('SIGKILL'),90000);
try{
 let url='';for(let i=0;i<600;i++){url=output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]??'';if(url)break;await Bun.sleep(50);}if(!url)throw new Error('Backend start timeout');
 const client=createOpencodeClient({baseUrl:url,headers:{Authorization:'Basic '+Buffer.from('fixture:fixture-private-password').toString('base64')}});
 const ids=await client.tool.ids({query:{directory:project}});evidence.registered_tools=ids.data?.filter(x=>x.startsWith('office_'));if(evidence.registered_tools?.length!==6)throw new Error('Expected six office tools');
 const session=await client.session.create({query:{directory:project},body:{title:'Office isolated fixture'}});const id=session.data?.id;if(!id)throw new Error('Session creation failed');
 const result=await client.session.prompt({path:{id},query:{directory:project},body:{parts:[{type:'text',text:workflow?'Inspect the synthetic revenue workbook, derive a report from its observed cells, then validate the report.':'Run the synthetic local HTML generation fixture, then validate it in a new evidence directory.'}]}});
 evidence.artifact_created=existsSync(join(project,'fixture.html'));evidence.model_requests=requests;const qaPath=join(project,'qa-evidence','report.json');evidence.validation_report_created=existsSync(qaPath);const qa=evidence.validation_report_created?JSON.parse(readFileSync(qaPath,'utf8')):null;evidence.validation_passed=qa?.passed===true;evidence.validation_status=qa?.status;evidence.validation_error=qa?.error??null;evidence.source=sourceEvidence;evidence.success=evidence.artifact_created&&evidence.validation_passed&&requests===(workflow?4:3)&&(!workflow||(sourceEvidence?.chart_count===1&&sourceEvidence?.formulas_unverified));
 if(!evidence.success)throw new Error('Real host tool execution did not complete');
}catch(error){evidence.success=false;evidence.error=String(error);process.exitCode=1;}
finally{clearTimeout(timeout);child.kill('SIGKILL');await child.exited;model.stop(true);mkdirSync('office/evidence',{recursive:true});writeFileSync('office/evidence/opencode-host-integration'+(workflow?'-workflow':'')+(interactive?'-interactive':'')+'.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));}
