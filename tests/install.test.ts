import {test,expect} from 'bun:test';import {mkdtempSync,existsSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
test('installer is dry-run by default, reversible and refuses foreign files before mutation',async()=>{
  const root=mkdtempSync(join(tmpdir(),'workbench-install-'));const config=join(root,'.opencode');const wrapper=join(config,'plugins','workbench-tasks.ts');const skill=join(config,'skills','task-manager','SKILL.md');
  const run=async(...args:string[])=>{const p=Bun.spawn(['bun','scripts/install.ts','--project',root,...args],{stdout:'pipe',stderr:'pipe'});await new Response(p.stdout).text();await new Response(p.stderr).text();return p.exited;};
  try{
    expect(await run()).toBe(0);expect(existsSync(wrapper)).toBe(false);expect(await run('--apply')).toBe(0);expect(existsSync(wrapper)).toBe(true);expect(existsSync(skill)).toBe(true);
    expect(await run('--remove','--apply')).toBe(0);expect(existsSync(wrapper)).toBe(false);expect(existsSync(skill)).toBe(false);
    mkdirSync(join(config,'skills','task-manager'),{recursive:true});writeFileSync(skill,'foreign skill');expect(await run('--apply')).not.toBe(0);expect(existsSync(wrapper)).toBe(false);expect(readFileSync(skill,'utf8')).toBe('foreign skill');
  }finally{rmSync(root,{recursive:true});}
});
