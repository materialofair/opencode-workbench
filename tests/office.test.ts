import {test,expect} from 'bun:test';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {executeOffice,OfficeArtifacts} from '../adapters/office/plugin';

test('office subprocess rejects operations and project escapes without a shell',async()=>{
 const root=mkdtempSync(join(tmpdir(),'office-test-'));
 try {
  await expect(executeOffice(root,{operation:'shell'})).rejects.toThrow('Unknown operation');
  await expect(executeOffice(root,{operation:'inspect_excel',input:'../secret.xlsx'})).rejects.toThrow('parent paths');
  await expect(executeOffice(root,{operation:'render_html',output:'/tmp/a.html',spec:{}})).rejects.toThrow('Absolute');
 } finally {rmSync(root,{recursive:true,force:true});}
});
test('office request budget is enforced before spawn',async()=>{
 await expect(executeOffice('.', {spec:'x'.repeat(1_048_577)})).rejects.toThrow('1 MiB');
});
test('office installer dry-run and repeat apply preserve existing content',()=>{
 const root=mkdtempSync(join(tmpdir(),'office-install-'));
 try{
  const invoke=(extra:string[])=>Bun.spawnSync(['bun','scripts/install-office.ts','--project',root,...extra]);
  expect(invoke([]).exitCode).toBe(0);
  expect(invoke(['--apply']).exitCode).toBe(0);
  expect(invoke(['--apply']).exitCode).toBe(0);
  const plugin=join(root,'.opencode/plugins/office-artifacts.js');
  writeFileSync(plugin,'user modification');
  expect(invoke(['--apply']).exitCode).not.toBe(0);
  expect(readFileSync(plugin,'utf8')).toBe('user modification');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('office installer refuses symlink directories',()=>{
 const root=mkdtempSync(join(tmpdir(),'office-link-')), outside=mkdtempSync(join(tmpdir(),'office-outside-'));
 try{symlinkSync(outside,join(root,'.opencode'),'dir');const result=Bun.spawnSync(['bun','scripts/install-office.ts','--project',root,'--apply']);expect(result.exitCode).not.toBe(0);}finally{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}

});

test('office tool obeys host denial before launching engine',async()=>{
 const root=mkdtempSync(join(tmpdir(),'office-denial-'));
 try{const plugin=await OfficeArtifacts({directory:root} as any);let requested:any;const context={ask:async(x:any)=>{requested=x;throw new Error('host denied');},abort:new AbortController().signal};await expect(plugin.tool!.office_generate_excel.execute({spec:'{}',output:'new.xlsx'},context as any)).rejects.toThrow('host denied');expect(requested.permission).toBe('edit');expect(requested.patterns).toEqual(['new.xlsx']);}finally{rmSync(root,{recursive:true,force:true});}
});

test('office subprocess refuses pre-cancelled request',async()=>{
 const controller=new AbortController();controller.abort();await expect(executeOffice('.',{},controller.signal)).rejects.toThrow('cancelled before');
});

test('office cancellation stops a running subprocess before late output',async()=>{
 const root=mkdtempSync(join(tmpdir(),'office-cancel-')), previous=process.env.OPENCODE_OFFICE_PYTHON;
 try{const fake=join(root,'fake-python'), marker=join(root,'late-output');writeFileSync(fake,'#!/usr/bin/env node\nsetTimeout(()=>{require("node:fs").writeFileSync('+JSON.stringify(marker)+',"late");console.log(JSON.stringify({ok:true}));},500);\n',{mode:0o700});process.env.OPENCODE_OFFICE_PYTHON=fake;const controller=new AbortController();const promise=executeOffice(root,{},controller.signal);setTimeout(()=>controller.abort(),70);await expect(promise).rejects.toThrow('cancelled');await Bun.sleep(600);expect(existsSync(marker)).toBe(false);}finally{if(previous===undefined)delete process.env.OPENCODE_OFFICE_PYTHON;else process.env.OPENCODE_OFFICE_PYTHON=previous;rmSync(root,{recursive:true,force:true});}
});

test('capabilities returns runnable HTML and Excel examples without source lookup',async()=>{
 const root=mkdtempSync(join(tmpdir(),'office-discover-'));
 try{const plugin=await OfficeArtifacts({directory:root} as any);const context={} as any;const html=JSON.parse(await plugin.tool!.office_capabilities.execute({topic:'html',example:'dashboard'},context) as string);expect(html.protocol_version).toBe(1);const h=JSON.parse(await executeOffice(root,{operation:'render_html',spec:html.example,output:'report.html'}));expect(h.ok).toBe(true);const excel=JSON.parse(await plugin.tool!.office_capabilities.execute({topic:'excel'},context) as string);const x=JSON.parse(await executeOffice(root,{operation:'generate_excel',spec:excel.excel.example,output:'data.xlsx'}));expect(x.ok).toBe(true);}finally{rmSync(root,{recursive:true,force:true});}
});
