import {test,expect} from 'bun:test';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,existsSync,rmSync,symlinkSync,realpathSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {executeHtmlValidation,validateHtmlPaths} from '../adapters/office/validate';
import {OfficeArtifacts,executeOffice} from '../adapters/office/plugin';
const fixture=()=>{const root=mkdtempSync(join(tmpdir(),'office-validate-tool-'));writeFileSync(join(root,'report.html'),readFileSync('office/examples/dashboard.html'));return root;};

test('HTML validation checks project paths and refuses existing or escaped evidence',()=>{
 const root=fixture(),outside=mkdtempSync(join(tmpdir(),'office-outside-'));
 try{mkdirSync(join(root,'existing'));writeFileSync(join(outside,'outside.html'),'<html/>');symlinkSync(outside,join(root,'outside'),'dir');
 for(const [input,output] of [['../secret.html','new'],['report.html','../new'],['report.html','existing'],['outside/outside.html','new'],['report.html','outside/new']])expect(()=>validateHtmlPaths(root,input,output)).toThrow();
 expect(validateHtmlPaths(root,'report.html','new').outputPath).toBe(join(realpathSync(root),'new'));
 }finally{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});

test('validator asks read then edit and honours each denial without evidence creation',async()=>{
 const root=fixture();try{const plugin=await OfficeArtifacts({directory:root} as any);
 for(const deny of ['read','edit']){const calls:string[]=[];await expect(plugin.tool!.office_validate_html.execute({input:'report.html',output:'evidence'},{abort:new AbortController().signal,ask:async(a:any)=>{calls.push(a.permission);if(a.permission===deny)throw new Error('denied '+deny);}} as any)).rejects.toThrow('denied');expect(calls).toEqual(deny==='read'?['read']:['read','edit']);expect(existsSync(join(root,'evidence'))).toBe(false);}
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('actual validator tool returns structured success with concrete evidence',async()=>{
 const root=fixture();try{const plugin=await OfficeArtifacts({directory:root} as any);const asks:any[]=[];const result=JSON.parse(await plugin.tool!.office_validate_html.execute({input:'report.html',output:'evidence'},{abort:new AbortController().signal,ask:async(a:any)=>{asks.push(a);}} as any) as string);expect(result.ok).toBe(true);expect(result.status).toBe('passed');expect(asks.map(a=>a.permission)).toEqual(['read','edit']);expect(asks[1].patterns).toEqual(['evidence/**']);for(const e of result.report.evidence)expect(existsSync(join(root,'evidence',e.filename))).toBe(true);
 }finally{rmSync(root,{recursive:true,force:true});}
},30000);

test('pre-cancellation returns structured non-pass without spawning',async()=>{
 const root=fixture();try{const controller=new AbortController();controller.abort();const result=JSON.parse(await executeHtmlValidation(root,'report.html','evidence',controller.signal));expect(result.status).toBe('cancelled');expect(result.ok).toBe(false);expect(existsSync(join(root,'evidence'))).toBe(false);}finally{rmSync(root,{recursive:true,force:true});}
});

test('validator cancellation kills subprocess descendants before late writes',async()=>{
 if(process.platform==='win32')return;const root=fixture(),before=process.env.OPENCODE_OFFICE_NODE;
 try{const fake=join(root,'fake-node'),marker=join(root,'grandchild-wrote');writeFileSync(fake,'#!/usr/bin/env node\nconst {spawn}=require("node:child_process");spawn(process.execPath,["-e",'+JSON.stringify('setTimeout(()=>require("node:fs").writeFileSync('+JSON.stringify(marker)+',"unexpected"),700);')+'],{stdio:"ignore"});setTimeout(()=>{},10000);\n',{mode:0o700});process.env.OPENCODE_OFFICE_NODE=fake;const controller=new AbortController();const promise=executeHtmlValidation(root,'report.html','evidence',controller.signal);setTimeout(()=>controller.abort(),180);const result=JSON.parse(await promise);expect(result.status).toBe('cancelled');await Bun.sleep(800);expect(existsSync(marker)).toBe(false);}finally{if(before===undefined)delete process.env.OPENCODE_OFFICE_NODE;else process.env.OPENCODE_OFFICE_NODE=before;rmSync(root,{recursive:true,force:true});}
},10000);

test('validator rejects overbudget or malformed worker stdout and strips secrets',async()=>{
 if(process.platform==='win32')return;const root=fixture(),before=process.env.OPENCODE_OFFICE_NODE,secret=process.env.OFFICE_QA_SECRET;
 try{const fake=join(root,'fake-node');process.env.OPENCODE_OFFICE_NODE=fake;process.env.OFFICE_QA_SECRET='not-for-worker';
 writeFileSync(fake,'#!/usr/bin/env node\nrequire("node:fs").writeFileSync('+JSON.stringify(join(root,'env-check'))+',JSON.stringify(process.env.OFFICE_QA_SECRET||null));console.log(JSON.stringify({version:2,mode:"static",passed:true,status:"passed",evidence:[]}));\n',{mode:0o700});let result=JSON.parse(await executeHtmlValidation(root,'report.html','one'));expect(result.ok).toBe(false);expect(result.error).toContain('evidence directory');expect(readFileSync(join(root,'env-check'),'utf8')).toBe('null');
 writeFileSync(fake,'#!/usr/bin/env node\nprocess.stdout.write("x".repeat(1100000));setTimeout(()=>{},10000);\n',{mode:0o700});result=JSON.parse(await executeHtmlValidation(root,'report.html','two'));expect(result.ok).toBe(false);expect(result.error).toContain('1 MiB');
 writeFileSync(fake,'#!/usr/bin/env node\nconsole.log("bad json");\n',{mode:0o700});result=JSON.parse(await executeHtmlValidation(root,'report.html','three'));expect(result.ok).toBe(false);expect(result.error).toContain('Invalid validation response');
 }finally{if(before===undefined)delete process.env.OPENCODE_OFFICE_NODE;else process.env.OPENCODE_OFFICE_NODE=before;if(secret===undefined)delete process.env.OFFICE_QA_SECRET;else process.env.OFFICE_QA_SECRET=secret;rmSync(root,{recursive:true,force:true});}
},10000);


test('fixed first-party runtime validation is explicit and arbitrary mode is refused',async()=>{
 const root=fixture();try{
  const unsupported=JSON.parse(await executeHtmlValidation(root,'report.html','no-evidence',undefined,'arbitrary-javascript' as any));
  expect(unsupported.status).toBe('unsupported');expect(existsSync(join(root,'no-evidence'))).toBe(false);
  await executeOffice(root,{operation:'render_html',output:'interactive.html',spec:{version:1,scenario:'operations',title:'Explicit local table runtime',interaction:'first-party-table',sections:[{type:'table',headers:['Name','Value'],rows:[['Gamma',10],['Alpha',2],['Beta',null]]}]}});
  const plain=JSON.parse(await executeHtmlValidation(root,'interactive.html','static-evidence'));
  expect(plain.status).toBe('unsupported');
  const plugin=await OfficeArtifacts({directory:root} as any);const verified=JSON.parse(await plugin.tool!.office_validate_html.execute({input:'interactive.html',output:'interactive-evidence',mode:'first-party-table'},{abort:new AbortController().signal,ask:async()=>{}} as any) as string);
  expect(verified.ok).toBe(true);expect(verified.report.mode).toBe('first-party-table');
  expect(verified.report.views.every((v:any)=>v.script_interactions_tested&&v.fixed_runtime_checks.length>0)).toBe(true);
 }finally{rmSync(root,{recursive:true,force:true});}
},60000);
