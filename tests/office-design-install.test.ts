import {test,expect} from 'bun:test';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('visual skill installs inert offline references with licenses, dry-run and no overwrite',()=>{
 const root=mkdtempSync(join(tmpdir(),'office-design-'));
 const invoke=(apply=false)=>Bun.spawnSync(['bun','scripts/install-office.ts','--project',root,...(apply?['--apply']:[])]);
 try{
  expect(invoke().exitCode).toBe(0);expect(existsSync(join(root,'.opencode'))).toBe(false);
  expect(invoke(true).exitCode).toBe(0);expect(invoke(true).exitCode).toBe(0);
  const dir=join(root,'.opencode/skills/office-visual-composition');
  expect(readFileSync(join(dir,'SKILL.md'),'utf8')).toContain('pending-human-review');
  for(const name of ['anthropic-LICENSE.txt','vercel-LICENSE','ui-ux-pro-max/LICENSE','ui-ux-pro-max/data/charts.csv','ADAPTATION.md'])expect(existsSync(join(dir,'references',name))).toBe(true);
  expect(existsSync(join(dir,'references/ui-ux-pro-max/scripts/search.py'))).toBe(false);
  expect(existsSync(join(dir,'references/ui-ux-pro-max/data/google-fonts.csv'))).toBe(false);
  const target=join(dir,'references/ADAPTATION.md');writeFileSync(target,'owner text');
  expect(invoke(true).exitCode).not.toBe(0);expect(readFileSync(target,'utf8')).toBe('owner text');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('installer rejects dangling reference symlink before any writes',()=>{
 const root=mkdtempSync(join(tmpdir(),'office-design-link-'));
 try{
  const dir=join(root,'.opencode/skills/office-visual-composition');mkdirSync(dir,{recursive:true});
  symlinkSync(join(root,'missing'),join(dir,'references'),'dir');
  const result=Bun.spawnSync(['bun','scripts/install-office.ts','--project',root,'--apply']);
  expect(result.exitCode).not.toBe(0);expect(existsSync(join(root,'.opencode/plugins/office-artifacts.js'))).toBe(false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
