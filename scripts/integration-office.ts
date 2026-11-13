// Real OpenCode discovery + tools, isolated HOME, deterministic loopback model.
// This is a protocol integration fixture, not evidence of GLM reasoning quality.
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,realpathSync,readFileSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';import {join,resolve} from 'node:path';
import {executeOffice} from '../adapters/office/plugin.ts';
import {createOpencodeClient} from '@opencode-ai/sdk/client';
import {createOpencodeClient as createV2Client} from '@opencode-ai/sdk/v2/client';

const SKILLS=['office-artifacts','office-visual-composition'];
export function toolTranscript(messages:any[]){
 const calls=new Map<string,{name:string,args:any}>();const results:{name:string,args:any,text:string}[]=[];
 for(const message of messages){
  if(message.role==='assistant')for(const call of message.tool_calls??[])calls.set(call.id,{name:call.function.name,args:JSON.parse(call.function.arguments)});
  if(message.role==='tool'){
   const call=calls.get(message.tool_call_id);if(!call)throw new Error('Tool result has no preceding call');
   const text=typeof message.content==='string'?message.content:(message.content??[]).filter((x:any)=>x.type==='text').map((x:any)=>x.text).join('');
   results.push({...call,text});
  }
 }
 return results;
}
export function assertDiscoveredSkills(definitions:any[],skills:{name:string,description?:string}[],messages:any[]=[]){
 const skill=definitions.find((t:any)=>t.function?.name==='skill')?.function;
 if(!skill||!skill.parameters?.properties?.name)throw new Error('Actual model request lacks built-in skill(name) tool');
 const systemText=messages.filter(m=>m.role==='system'||m.role==='developer').map(m=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join('\n');
 const catalog=skill.description+'\n'+systemText;
 for(const name of SKILLS){const entry=skills.find(s=>s.name===name);if(!entry?.description||!catalog.includes(name)||!catalog.includes(entry.description))throw new Error('Skill description not visible to model: '+name);}
 return {name:skill.name,parameters:skill.parameters,descriptions_visible:SKILLS,catalog_in_system_messages:SKILLS.every(name=>systemText.includes(name))};
}
export function checkedOfficeResult(text:string){const value=JSON.parse(text);if(value.ok!==true||!value.result)throw new Error('Office tool did not return successful result');return value.result;}
export function checkedCapabilitiesResult(text:string){const value=JSON.parse(text);if(!value.protocol_version||!value.html||!value.design||value.example?.version!==1||!Array.isArray(value.example.sections))throw new Error('Capabilities missing executable protocol or returned example');return value;}
export function checkedValidationResult(text:string){const value=JSON.parse(text);if(value.ok!==true||value.report?.passed!==true||value.report?.status!=='passed')throw new Error('Real validation tool did not pass');return value;}
export function ordinaryTask(workflow:boolean,interactive:boolean){return workflow?'请分析当前目录的 source.xlsx，做一份给部门负责人的经营复盘网页，突出实际与预算差异，保留数据来源和公式缓存的限制。'+(interactive?'表格需要能搜索、排序。':'')+'请检查桌面和手机展示及打印结果，保留证据。':'请做一份适合部门负责人阅读的经营看板网页，使用明确标注的演示数据，突出结论、对比和后续行动。'+(interactive?'表格需要能搜索、排序。':'')+'请检查桌面和手机展示及打印结果，保留证据。';}

async function main(){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'office-host-fixture-'))),project=join(root,'project');mkdirSync(project);
 const workflow=process.argv.includes('--workflow'),interactive=process.argv.includes('--interactive'),userTask=ordinaryTask(workflow,interactive);
 const evidence:any={real_backend:true,real_model:false,uses_user_credentials:false,scope:'synthetic temporary project only',workflow,interactive,user_task:userTask,model_decision_policy:'deterministic fixture; verifies discovery and tool-return plumbing, not natural-language reasoning or visual judgement',temporary_project:project};
 let requests=0,sourceEvidence:any=null,discovered:any[]=[],mockError:string|undefined;
 if(workflow)await executeOffice(project,{operation:'generate_excel',output:'source.xlsx',spec:{sheets:[{name:'Revenue',rows:[['Month','Actual','Budget','Variance'],['Jan',120,130,{formula:'=B2-C2',cached:-10}],['Feb',155,150,{formula:'=B3-C3',cached:5}],['Mar',143,150,{formula:'=B4-C4',cached:-7}]]}],charts:[{type:'bar',title:'Revenue source chart',categories:['Jan','Feb','Mar'],series:[{name:'Actual',values:[120,155,143]}]}]}});
 const installation=Bun.spawnSync(['bun','scripts/install-office.ts','--project',project,'--apply'],{cwd:process.cwd(),stdout:'pipe',stderr:'pipe'});
 if(installation.exitCode!==0)throw new Error('Real installer failed: '+new TextDecoder().decode(installation.stderr));
 evidence.installer_applied=true;evidence.project_autodiscovery=true;evidence.runtime_package_fetches='npm offline-only using provisioned .data/npm-cache; no runtime package download permitted';
 for(const name of SKILLS)if(!existsSync(join(project,'.opencode','skills',name,'SKILL.md')))throw new Error('Installer did not install '+name);
 const actionNames=['skill','skill','office_capabilities','office_design_reference',...(workflow?['office_inspect_excel']:[]),'office_render_html','office_validate_html'];
 function completeResponse(delta:any,done:boolean){return new Response('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason:null}]})+'\n\ndata: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:{},finish_reason:done?'stop':'tool_calls'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});}
 const model=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
  if(!new URL(req.url).pathname.endsWith('/chat/completions'))return new Response('fixture only',{status:404});
  requests++;
  try{
   const body=await req.json() as any;
   if(!evidence.model_skill_discovery){evidence.actual_skill_tool=(body.tools??[]).find((t:any)=>t.function?.name==='skill')?.function;evidence.model_skill_discovery=assertDiscoveredSkills(body.tools??[],discovered,body.messages);}
   if(!JSON.stringify(body.messages).includes(userTask))throw new Error('Ordinary user task missing from model request');
   const history=toolTranscript(body.messages);if(history.length>actionNames.length)throw new Error('Unexpected extra tool calls');
   for(let i=0;i<history.length;i++)if(history[i].name!==actionNames[i])throw new Error('Tool sequence differs from fixture contract');
   if(history[0]&&(history[0].args.name!==SKILLS[0]||!history[0].text.includes('内网办公产物工作流')))throw new Error('Real office-artifacts skill content was not returned');
   if(history[1]&&(history[1].args.name!==SKILLS[1]||!history[1].text.includes('离线办公视觉编排')))throw new Error('Real visual skill content was not returned');
   let capabilities:any,reference:any;
   if(history[2]){capabilities=checkedCapabilitiesResult(history[2].text);}
   if(history[3]){reference=checkedOfficeResult(history[3].text);if(!reference.source?.commit||!reference.source?.file||!reference.results?.length)throw new Error('Design reference lacks provenance/results');evidence.design_reference={status:reference.status,source:reference.source,entries:reference.results.map((r:any)=>r.entry)};}
   let renderSpec=capabilities?structuredClone(capabilities.example):undefined;
   if(workflow&&history[4]){
    const report=checkedOfficeResult(history[4].text);const revenue=report.sheets.find((s:any)=>s.name==='Revenue');if(!revenue)throw new Error('Observed Revenue sheet missing');
    const cells=new Map(revenue.cells.map((c:any)=>[c.cell,c]));
    const rows=[2,3,4].map(row=>[(cells.get('A'+row) as any)?.value,(cells.get('B'+row) as any)?.value,(cells.get('C'+row) as any)?.value]);
    if(JSON.stringify(rows)!==JSON.stringify([['Jan',120,130],['Feb',155,150],['Mar',143,150]]))throw new Error('Observed workbook data did not match independent fixture expectation');
    sourceEvidence={sha256:report.source_sha256,chart_count:report.charts.length,formulas_unverified:revenue.formulas.every((f:any)=>f.cache_status==='unverified'),rows};
    renderSpec={version:1,scenario:'operations',title:'从工作簿读取的经营复盘',subtitle:'合成数据；公式缓存未重算。参考检索只验证调用，不代表真实模型视觉判断。',sections:[{type:'table',title:'实际与预算',headers:['月份','实际','预算'],rows},{type:'chart',chart:{type:'bar',title:'实际收入',categories:rows.map(r=>r[0]),series:[{name:'实际',values:rows.map(r=>r[1])}]}},{type:'text',body:'Source SHA256: '+report.source_sha256+'; formula caches remain unverified.'}]};
   }
   if(renderSpec&&reference)renderSpec.footer='设计参考：'+reference.source.repository+' / '+reference.source.file+' / '+reference.results[0].entry+'（固定流程接线测试，不代表模型审美判断）';
   const renderIndex=workflow?5:4,validateIndex=renderIndex+1;
   if(history[renderIndex]){const rendered=checkedOfficeResult(history[renderIndex].text);if(!rendered.artifact?.endsWith('fixture.html')||!rendered.sha256)throw new Error('Render output missing observed artifact identity');evidence.render_result={sha256:rendered.sha256,artifact:rendered.artifact};}
   if(history[validateIndex]){const validated=checkedValidationResult(history[validateIndex].text);evidence.observed_validation_result={ok:validated.ok,passed:validated.report.passed,status:validated.status};}
   evidence.observed_tool_results=history.map(({name,args})=>({name,args:name==='skill'?args:undefined}));
   const index=history.length,done=index===actionNames.length;
   if(done)return completeResponse({role:'assistant',content:'已在隔离测试项目完成技能加载、数据读取、网页生成与检查。视觉审查与真实模型决策不在本次模拟验收范围。'},true);
   const name=actionNames[index];if(!(body.tools??[]).some((t:any)=>t.function?.name===name))throw new Error('Required tool not exposed to model: '+name);
   let args:any;
   if(index<2)args={name:SKILLS[index]};
   else if(index===2)args={topic:'overview',example:'dashboard'};
   else if(index===3)args={query:'editorial enterprise dashboard',domain:'style',limit:2};
   else if(name==='office_inspect_excel')args={input:'source.xlsx',options:JSON.stringify({sheets:['Revenue','ChartData1'],max_rows:4,max_cols:4,max_cells:32})};
   else if(name==='office_render_html'){if(interactive)renderSpec.interaction='first-party-table';args={spec:JSON.stringify(renderSpec),output:'fixture.html'};}
   else args={input:'fixture.html',output:'qa-evidence',mode:interactive?'first-party-table':'static'};
   return completeResponse({role:'assistant',tool_calls:[{index:0,id:'office_fixture_call_'+index,type:'function',function:{name,arguments:JSON.stringify(args)}}]},false);
  }catch(error){mockError=String(error);evidence.mock_error=mockError;return completeResponse({role:'assistant',content:'Fixture rejected: '+mockError},true);}
 }});
 const config=join(root,'config','opencode');mkdirSync(config,{recursive:true});mkdirSync(join(root,'home'));
 // No explicit plugin URL: the real installed project plugin and skills must be discovered.
 writeFileSync(join(config,'opencode.json'),JSON.stringify({model:'fixture/mock',permission:{'*':'deny',skill:{'*':'deny','office-artifacts':'allow','office-visual-composition':'allow'},office_capabilities:'allow',office_design_reference:'allow',office_render_html:'allow',office_inspect_excel:'allow',office_validate_html:'allow',read:{'*':'deny','source.xlsx':'allow','fixture.html':'allow'},edit:{'*':'deny','fixture.html':'allow','qa-evidence/**':'allow'}},provider:{fixture:{npm:'@ai-sdk/openai-compatible',name:'Loopback fixture',options:{baseURL:`http://127.0.0.1:${model.port}/v1`,apiKey:'fixture-only'},models:{mock:{name:'Fixture',limit:{context:65536,output:8192}}}}}}));
 const binary=resolve(`node_modules/opencode-${process.platform==='win32'?'windows':process.platform}-${process.arch}/bin/opencode${process.platform==='win32'?'.exe':''}`);
 if(!existsSync(binary))throw new Error('Pinned OpenCode test binary missing');
 const browserCache=process.env.PLAYWRIGHT_BROWSERS_PATH||(process.platform==='darwin'?join(homedir(),'Library','Caches','ms-playwright'):join(homedir(),'.cache','ms-playwright'));
 const env={npm_config_offline:'true',npm_config_ignore_scripts:'true',npm_config_cache:resolve('.data/npm-cache'),PLAYWRIGHT_BROWSERS_PATH:browserCache,PATH:process.env.PATH??'',HOME:join(root,'home'),XDG_CONFIG_HOME:join(root,'config'),XDG_DATA_HOME:join(root,'data'),XDG_CACHE_HOME:join(root,'cache'),XDG_STATE_HOME:join(root,'state'),OPENCODE_DISABLE_AUTOUPDATE:'true',OPENCODE_DISABLE_LSP_DOWNLOAD:'true',OPENCODE_DISABLE_DEFAULT_PLUGINS:'true',OPENCODE_DISABLE_MODELS_FETCH:'true',OPENCODE_SERVER_PASSWORD:'fixture-private-password',OPENCODE_SERVER_USERNAME:'fixture'};
 const child=Bun.spawn([binary,'serve','--port','0','--hostname','127.0.0.1'],{cwd:project,env,stdout:'pipe',stderr:'pipe'});let output='';void(async()=>{for await(const c of child.stdout)output+=new TextDecoder().decode(c)})();void(async()=>{for await(const _c of child.stderr){/* isolated logs omitted */}})();
 const timeout=setTimeout(()=>child.kill('SIGKILL'),90000);
 try{
  let url='';for(let i=0;i<600;i++){url=output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]??'';if(url)break;await Bun.sleep(50);}if(!url)throw new Error('Backend start timeout');
  const headers={Authorization:'Basic '+Buffer.from('fixture:fixture-private-password').toString('base64')};const client=createOpencodeClient({baseUrl:url,headers}),v2=createV2Client({baseUrl:url,headers});
  const skills=await v2.app.skills({directory:project});if(skills.error)throw new Error('Actual /skill endpoint failed: '+JSON.stringify(skills.error));discovered=skills.data??[];
  evidence.discovered_skills=discovered.filter(s=>SKILLS.includes(s.name)).map(({name,description,location})=>({name,description,location}));
  if(evidence.discovered_skills.length!==2||!evidence.discovered_skills.every((s:any)=>s.location.startsWith(project)))throw new Error('Both project skills were not discovered from installed location');
  const ids=await client.tool.ids({query:{directory:project}});evidence.registered_tools=ids.data?.filter(x=>x.startsWith('office_'));if(!['office_capabilities','office_design_reference','office_inspect_excel','office_generate_excel','office_render_html','office_validate_html'].every(name=>evidence.registered_tools?.includes(name)))throw new Error('Required office tools missing');
  const session=await client.session.create({query:{directory:project},body:{title:'普通任务技能发现与办公链路隔离测试'}});const id=session.data?.id;if(!id)throw new Error('Session creation failed');
  await client.session.prompt({path:{id},query:{directory:project},body:{parts:[{type:'text',text:userTask}]}});
  evidence.artifact_created=existsSync(join(project,'fixture.html'));evidence.model_requests=requests;const qaPath=join(project,'qa-evidence','report.json');evidence.validation_report_created=existsSync(qaPath);const qa=evidence.validation_report_created?JSON.parse(readFileSync(qaPath,'utf8')):null;evidence.validation_passed=qa?.passed===true;evidence.validation_status=qa?.status;evidence.validation_error=qa?.error??null;evidence.source=sourceEvidence;
  evidence.success=!mockError&&evidence.artifact_created&&evidence.validation_passed&&requests===actionNames.length+1&&evidence.observed_tool_results?.length===actionNames.length&&(!workflow||(sourceEvidence?.chart_count===1&&sourceEvidence?.formulas_unverified));
  if(!evidence.success)throw new Error('Real discovery and host tool execution did not complete');
 }catch(error){evidence.success=false;evidence.error=String(error);process.exitCode=1;}
 finally{clearTimeout(timeout);child.kill('SIGKILL');await child.exited;model.stop(true);mkdirSync('office/evidence/host-runs',{recursive:true});writeFileSync(join('office/evidence/host-runs',root.split('/').at(-1)!+'.json'),JSON.stringify(evidence,null,2));writeFileSync('office/evidence/opencode-host-integration'+(workflow?'-workflow':'')+(interactive?'-interactive':'')+'.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));}
}
if(import.meta.main)await main();
