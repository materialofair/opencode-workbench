import {test,expect} from 'bun:test';import {mkdtempSync,existsSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
test('installer is dry-run by default, reversible and refuses foreign files before mutation',async()=>{
  const root=mkdtempSync(join(tmpdir(),'workbench install 中文-'));const config=join(root,'.opencode');const wrapper=join(config,'plugins','workbench-tasks.js');const skill=join(config,'skills','task-manager','SKILL.md');
  const run=async(...args:string[])=>{const p=Bun.spawn([process.execPath,'scripts/install.ts','--project',root,...args],{stdout:'pipe',stderr:'pipe'});await new Response(p.stdout).text();await new Response(p.stderr).text();return p.exited;};
  try{
    expect(await run()).toBe(0);expect(existsSync(wrapper)).toBe(false);expect(await run('--apply')).toBe(0);expect(existsSync(wrapper)).toBe(true);expect(existsSync(skill)).toBe(true);
    const importer=join(config,'skills','import-scheduled-tasks','SKILL.md'),collector=join(config,'skills','import-scheduled-tasks','scripts','collect.py');expect(existsSync(importer)).toBe(true);expect(existsSync(collector)).toBe(true);
    expect(await run('--remove','--apply')).toBe(0);expect(existsSync(wrapper)).toBe(false);expect(existsSync(skill)).toBe(false);
    expect(existsSync(importer)).toBe(false);expect(existsSync(collector)).toBe(false);
    mkdirSync(join(config,'skills','task-manager'),{recursive:true});writeFileSync(skill,'foreign skill');expect(await run('--apply')).not.toBe(0);expect(existsSync(wrapper)).toBe(false);expect(readFileSync(skill,'utf8')).toBe('foreign skill');
  }finally{rmSync(root,{recursive:true});}
});
test('installer refuses a symbolic link or Windows junction before writing outside the selected project',async()=>{
  const root=mkdtempSync(join(tmpdir(),'workbench-link-fixture-')),outside=mkdtempSync(join(tmpdir(),'workbench-link-target-'));
  try{
    symlinkSync(outside,join(root,'.opencode'),process.platform==='win32'?'junction':'dir');
    const p=Bun.spawn([process.execPath,'scripts/install.ts','--project',root,'--apply'],{stdout:'pipe',stderr:'pipe'});
    await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text()]);expect(await p.exited).not.toBe(0);
    expect(existsSync(join(outside,'plugins','workbench-tasks.js'))).toBe(false);
  }finally{rmSync(root,{recursive:true});rmSync(outside,{recursive:true});}
});
