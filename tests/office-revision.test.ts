import {test,expect} from 'bun:test';
import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {OfficeArtifacts,executeOffice} from '../adapters/office/plugin';
const spec={version:1,scenario:'research',title:'Original',sections:[{type:'text',body:'Keep this evidence.'},{type:'table',headers:['Value'],rows:[[12],[null]]}]};
test('source and revision tools preserve unrequested data through the real Python boundary',async()=>{
 const root=mkdtempSync(join(tmpdir(),'office-revision-'));
 try{
  await executeOffice(root,{operation:'render_html',output:'source.html',spec});
  const original=readFileSync(join(root,'source.html'));
  const plugin=await OfficeArtifacts({directory:root} as any);const asks:any[]=[];
  const context={ask:async(x:any)=>{asks.push(x);},abort:new AbortController().signal} as any;
  const source=JSON.parse(await plugin.tool!.office_read_html_source.execute({input:'source.html'},context) as string).result;
  expect(source.spec).toEqual(spec);expect(source.input_sha256).toMatch(/^[a-f0-9]{64}$/);
  await plugin.tool!.office_revise_html.execute({input:'source.html',output:'v2.html',expected_input_sha256:source.input_sha256,changes:JSON.stringify([{path:'/title',old:'Original',value:'Revised'}])},context);
  const after=JSON.parse(await executeOffice(root,{operation:'read_html_source',input:'v2.html'})).result;
  expect(after.spec).toEqual({...spec,title:'Revised'});expect(readFileSync(join(root,'source.html'))).toEqual(original);
  expect(asks.map(x=>[x.permission,...x.patterns])).toEqual([['read','source.html'],['read','source.html'],['edit','v2.html']]);
  await expect(executeOffice(root,{operation:'revise_html',input:'source.html',output:'bad.html',expected_input_sha256:'0'.repeat(64),changes:[{path:'/title',old:'Original',value:'Wrong'}]})).rejects.toThrow();expect(existsSync(join(root,'bad.html'))).toBe(false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('revision stops on read denial and edit denial without a new artifact',async()=>{
 const root=mkdtempSync(join(tmpdir(),'office-revision-denial-'));
 try{
  const plugin=await OfficeArtifacts({directory:root} as any);
  for(const denied of ['read','edit']){
   const asks:string[]=[];const context={ask:async(x:any)=>{asks.push(x.permission);if(x.permission===denied)throw new Error('host denied');},abort:new AbortController().signal} as any;
   await expect(plugin.tool!.office_revise_html.execute({input:'source.html',output:'new.html',expected_input_sha256:'0'.repeat(64),changes:'[]'},context)).rejects.toThrow('host denied');
   expect(asks).toEqual(denied==='read'?['read']:['read','edit']);expect(existsSync(join(root,'new.html'))).toBe(false);
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});
