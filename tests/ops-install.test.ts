import {test,expect} from 'bun:test';
import {mkdtempSync,existsSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const names=['devops-engineer','sre-engineer','monitoring-expert'];
async function run(args:string[],env=process.env){
  const p=Bun.spawn([process.execPath,'scripts/install-ops.ts',...args],{env,stdout:'pipe',stderr:'pipe'});
  const [out,err]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text()]);
  return {code:await p.exited,out,err};
}
function files(dir:string):string[]{return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)).map(p=>join(e.name,p)):[e.name]);}
test('ops skills copy complete references and license; dry-run, idempotency and removal preserve unrelated files',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ops 中文 space-')),target=join(root,'.opencode','skills');
 try{
  expect((await run(['--project',root])).code).toBe(0);expect(existsSync(target)).toBe(false);
  expect((await run(['--project',root,'--apply'])).code).toBe(0);
  for(const name of names){
   const source=join('skills',name);
   expect(files(join(target,name)).sort()).toEqual(files(source).sort());
   for(const path of files(source))expect(readFileSync(join(target,name,path),'utf8')).toBe(readFileSync(join(source,path),'utf8'));
   const text=readFileSync(join(target,name,'SKILL.md'),'utf8');
   expect(text).toContain(`name: ${name}`);
   for(const match of text.matchAll(/\]\((references\/[^)]+)\)/g))expect(existsSync(join(target,name,match[1]))).toBe(true);
  }
  expect((await run(['--project',root,'--apply'])).code).toBe(0);
  const custom=join(target,names[0],'local-notes.md');writeFileSync(custom,'keep');
  expect((await run(['--project',root,'--remove'])).code).toBe(0);expect(existsSync(join(target,names[0],'SKILL.md'))).toBe(true);
  expect((await run(['--project',root,'--remove','--apply'])).code).toBe(0);
  for(const name of names)for(const path of files(join('skills',name)))expect(existsSync(join(target,name,path))).toBe(false);
  expect(readFileSync(custom,'utf8')).toBe('keep');
  expect(existsSync(join(root,'.opencode','plugins'))).toBe(false);
 }finally{rmSync(root,{recursive:true});}
});
test('ops conflict in last skill blocks all writes and removal',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ops-conflict-')),target=join(root,'.opencode','skills');
 try{
  const foreign=join(target,'monitoring-expert','references','dashboards.md');mkdirSync(join(target,'monitoring-expert','references'),{recursive:true});writeFileSync(foreign,'custom');
  expect((await run(['--project',root,'--apply'])).code).not.toBe(0);expect(existsSync(join(target,'devops-engineer'))).toBe(false);
  rmSync(join(root,'.opencode'),{recursive:true});expect((await run(['--project',root,'--apply'])).code).toBe(0);
  writeFileSync(foreign,'custom');expect((await run(['--project',root,'--remove','--apply'])).code).not.toBe(0);
  expect(existsSync(join(target,'devops-engineer','SKILL.md'))).toBe(true);expect(readFileSync(foreign,'utf8')).toBe('custom');
 }finally{rmSync(root,{recursive:true});}
});
test('ops refuses symlinks/junctions before writing outside target',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ops-link-')),outside=mkdtempSync(join(tmpdir(),'ops-outside-'));
 try{
  mkdirSync(join(root,'.opencode','skills'),{recursive:true});
  symlinkSync(outside,join(root,'.opencode','skills','monitoring-expert'),process.platform==='win32'?'junction':'dir');
  expect((await run(['--project',root,'--apply'])).code).not.toBe(0);
  expect(readdirSync(outside)).toEqual([]);expect(existsSync(join(root,'.opencode','skills','devops-engineer'))).toBe(false);
 }finally{rmSync(root,{recursive:true});rmSync(outside,{recursive:true});}
});
test('ops global installation respects isolated XDG_CONFIG_HOME and validates scope',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ops-global-'));
 try{
  const env={...process.env,XDG_CONFIG_HOME:root};
  expect((await run(['--global','--apply'],env)).code).toBe(0);
  expect(existsSync(join(root,'opencode','skills','sre-engineer','SKILL.md'))).toBe(true);
  expect((await run(['--global','--remove','--apply'],env)).code).toBe(0);
  expect((await run(['--global','--project',root],env)).code).not.toBe(0);
  expect((await run(['--project'],env)).code).not.toBe(0);
  expect((await run([],env)).code).not.toBe(0);
 }finally{rmSync(root,{recursive:true});}
});

test('ops rejects a regular file blocking a later skill directory before any writes',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ops-file-')),target=join(root,'.opencode','skills');
 try{
  mkdirSync(target,{recursive:true});writeFileSync(join(target,'monitoring-expert'),'keep');
  expect((await run(['--project',root,'--apply'])).code).not.toBe(0);
  expect(existsSync(join(target,'devops-engineer'))).toBe(false);
  expect(readFileSync(join(target,'monitoring-expert'),'utf8')).toBe('keep');
 }finally{rmSync(root,{recursive:true});}
});
