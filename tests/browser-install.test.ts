import {test,expect} from 'bun:test';
import {mkdtempSync,existsSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
test('browser installer is opt-in, reversible and never replaces existing BrowserSkill or Feishu configuration',async()=>{
  const project=mkdtempSync(join(tmpdir(),'workbench browser 项目-')),config=join(project,'.opencode');
  const wrapper=join(config,'plugins','workbench-browser.js'),skill=join(config,'skills','feishu-browser','SKILL.md');
  const run=async(...args:string[])=>{const p=Bun.spawn([process.execPath,'scripts/install-browser.ts','--project',project,...args],{stdout:'pipe',stderr:'pipe'});await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text()]);return p.exited;};
  try{
    mkdirSync(join(config,'skills','browser-skill'),{recursive:true});const original=join(config,'skills','browser-skill','SKILL.md');writeFileSync(original,'Existing independent skill');
    expect(await run()).toBe(0);expect(existsSync(wrapper)).toBe(false);expect(await run('--apply')).toBe(0);expect(existsSync(wrapper)).toBe(true);expect(readFileSync(original,'utf8')).toBe('Existing independent skill');
    expect(existsSync(join(config,'workbench-browser.json'))).toBe(false);expect(await run('--remove','--apply')).toBe(0);expect(existsSync(skill)).toBe(false);expect(existsSync(wrapper)).toBe(false);
    mkdirSync(join(config,'skills','feishu-browser'),{recursive:true});writeFileSync(skill,'Foreign skill');expect(await run('--apply')).not.toBe(0);expect(existsSync(wrapper)).toBe(false);
  }finally{rmSync(project,{recursive:true,maxRetries:5,retryDelay:50});}
});
