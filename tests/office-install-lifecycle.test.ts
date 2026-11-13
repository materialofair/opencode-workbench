import {test,expect} from 'bun:test';
import {cpSync,existsSync,linkSync,mkdtempSync,mkdirSync,readFileSync,readdirSync,realpathSync,rmSync,symlinkSync,unlinkSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const receipt='.opencode/office-artifacts.install.json';
const skill='.opencode/skills/office-artifacts/SKILL.md';
const wrapper='.opencode/plugins/office-artifacts.js';
const late='.opencode/skills/office-visual-composition/references/ui-ux-pro-max/data/app-interface.csv';
const sha=(content:Buffer)=>createHash('sha256').update(content).digest('hex');
function setup(){
 const base=mkdtempSync(join(tmpdir(),'office-lifecycle-')),project=join(base,'project'),source=join(base,'source');
 mkdirSync(project);mkdirSync(join(source,'scripts'),{recursive:true});mkdirSync(join(source,'adapters/office'),{recursive:true});
 cpSync(resolve('scripts/install-office.ts'),join(source,'scripts/install-office.ts'));
 cpSync(resolve('skills/office-artifacts'),join(source,'skills/office-artifacts'),{recursive:true});
 cpSync(resolve('skills/office-visual-composition'),join(source,'skills/office-visual-composition'),{recursive:true});
 cpSync(resolve('third-party/design-skills'),join(source,'third-party/design-skills'),{recursive:true});
 writeFileSync(join(source,'adapters/office/plugin.js'),'export const OfficeArtifacts = () => ({});\n');
 const run=(flags:string[]=[],from=source)=>Bun.spawnSync(['bun',join(from,'scripts/install-office.ts'),'--project',project,...flags]);
 return {base,project,source,run,cleanup:()=>rmSync(base,{recursive:true,force:true})};
}

test('manifest owns exact relative files and repeat install is idempotent',()=>{
 const f=setup();try{
  expect(f.run().exitCode).toBe(0);expect(existsSync(join(f.project,'.opencode'))).toBe(false);
  expect(f.run(['--apply']).exitCode).toBe(0);
  const before=readFileSync(join(f.project,receipt));const manifest=JSON.parse(before.toString());
  expect(manifest.installation).toBe('linked-source');expect(manifest.sourceRoot).toBe(realpathSync(f.source));
  for(const entry of manifest.files){const bytes=readFileSync(join(f.project,entry.path));expect(entry.sha256).toBe(sha(bytes));expect(entry.bytes).toBe(bytes.length);}
  const again=f.run(['--apply']);expect(again.exitCode).toBe(0);expect(JSON.parse(again.stdout.toString()).changes).toEqual([]);
  expect(readFileSync(join(f.project,receipt)).equals(before)).toBe(true);
 }finally{f.cleanup();}
});

test('explicit upgrade rebinds a moved source and replaces only recorded pristine files',()=>{
 const f=setup();try{
  expect(f.run(['--apply']).exitCode).toBe(0);
  const next=join(f.base,'new source');cpSync(f.source,next,{recursive:true});
  writeFileSync(join(next,'skills/office-artifacts/SKILL.md'),'new release\n');
  const old=readFileSync(join(f.project,receipt));
  expect(f.run(['--apply'],next).exitCode).not.toBe(0);
  expect(f.run(['--upgrade'],next).exitCode).toBe(0);expect(readFileSync(join(f.project,receipt)).equals(old)).toBe(true);
  expect(f.run(['--upgrade','--apply'],next).exitCode).toBe(0);
  expect(readFileSync(join(f.project,skill),'utf8')).toBe('new release\n');
  expect(readFileSync(join(f.project,wrapper),'utf8')).toContain('new%20source');
  expect(JSON.parse(readFileSync(join(f.project,receipt),'utf8')).sourceRoot).toBe(realpathSync(next));
 }finally{f.cleanup();}
});

test('late user modification aborts whole upgrade before earlier replacements',()=>{
 const f=setup();try{
  expect(f.run(['--apply']).exitCode).toBe(0);const before=readFileSync(join(f.project,skill)),manifest=readFileSync(join(f.project,receipt));
  writeFileSync(join(f.source,'skills/office-artifacts/SKILL.md'),'new version');writeFileSync(join(f.project,late),'owner modification');
  const result=f.run(['--upgrade','--apply']);expect(result.exitCode).not.toBe(0);expect(result.stderr.toString()).toContain('User-modified file preserved');
  expect(readFileSync(join(f.project,skill)).equals(before)).toBe(true);expect(readFileSync(join(f.project,receipt)).equals(manifest)).toBe(true);
  expect(readFileSync(join(f.project,late),'utf8')).toBe('owner modification');
 }finally{f.cleanup();}
});

test('uninstall preserves modified and unowned files, directories and data; can finish later',()=>{
 const f=setup();try{
  expect(f.run(['--apply']).exitCode).toBe(0);const pristine=readFileSync(join(f.project,skill));
  writeFileSync(join(f.project,skill),'owner modification');
  const unrelated=join(f.project,'.opencode/skills/ppt');mkdirSync(unrelated);writeFileSync(join(unrelated,'SKILL.md'),'PPT');
  writeFileSync(join(f.project,'report.html'),'user report');
  expect(f.run(['--uninstall']).exitCode).toBe(0);expect(existsSync(join(f.project,wrapper))).toBe(true);
  // Removal does not need the source adapter or reference corpus.
  rmSync(join(f.source,'adapters'),{recursive:true});rmSync(join(f.source,'third-party'),{recursive:true});
  const result=f.run(['--uninstall','--apply']);expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout.toString()).preserved).toEqual([skill]);
  expect(existsSync(join(f.project,wrapper))).toBe(false);expect(readFileSync(join(f.project,skill),'utf8')).toBe('owner modification');
  expect(JSON.parse(readFileSync(join(f.project,receipt),'utf8')).files.map((x:any)=>x.path)).toEqual([skill]);
  expect(readFileSync(join(unrelated,'SKILL.md'),'utf8')).toBe('PPT');expect(readFileSync(join(f.project,'report.html'),'utf8')).toBe('user report');
  expect(existsSync(join(f.project,'.opencode/plugins'))).toBe(true);
  writeFileSync(join(f.project,skill),pristine);expect(f.run(['--uninstall','--apply']).exitCode).toBe(0);
  expect(existsSync(join(f.project,receipt))).toBe(false);expect(f.run(['--uninstall','--apply']).exitCode).toBe(0);
 }finally{f.cleanup();}
});

test('legacy migration requires explicit exact-match adoption; uninstall never guesses ownership',()=>{
 const f=setup();try{
  expect(f.run(['--apply']).exitCode).toBe(0);unlinkSync(join(f.project,receipt));
  expect(f.run(['--apply']).exitCode).not.toBe(0);expect(f.run(['--upgrade','--apply']).exitCode).not.toBe(0);
  expect(f.run(['--uninstall','--apply']).exitCode).toBe(0);expect(existsSync(join(f.project,wrapper))).toBe(true);
  expect(f.run(['--adopt-legacy']).exitCode).toBe(0);expect(existsSync(join(f.project,receipt))).toBe(false);
  const pristine=readFileSync(join(f.project,late));writeFileSync(join(f.project,late),'changed');
  expect(f.run(['--adopt-legacy','--apply']).exitCode).not.toBe(0);expect(existsSync(join(f.project,receipt))).toBe(false);
  writeFileSync(join(f.project,late),pristine);expect(f.run(['--adopt-legacy','--apply']).exitCode).toBe(0);
  expect(existsSync(join(f.project,receipt))).toBe(true);
 }finally{f.cleanup();}
});

test('malicious manifest paths and duplicate entries cannot expand uninstall scope',()=>{
 const f=setup();try{
  expect(f.run(['--apply']).exitCode).toBe(0);const original=JSON.parse(readFileSync(join(f.project,receipt),'utf8'));
  writeFileSync(join(f.project,'private.txt'),'private');
  for(const path of ['../private.txt','/tmp/private.txt','C:\\private.txt','.opencode/skills/ppt/SKILL.md',receipt]){
   const bad=structuredClone(original);bad.files[0].path=path;writeFileSync(join(f.project,receipt),JSON.stringify(bad));
   expect(f.run(['--uninstall','--apply']).exitCode).not.toBe(0);expect(existsSync(join(f.project,wrapper))).toBe(true);
  }
  const bad=structuredClone(original);bad.files[1]=bad.files[0];writeFileSync(join(f.project,receipt),JSON.stringify(bad));
  expect(f.run(['--uninstall','--apply']).exitCode).not.toBe(0);expect(readFileSync(join(f.project,'private.txt'),'utf8')).toBe('private');
 }finally{f.cleanup();}
});

test('symlink, hardlink and concurrent lock reject lifecycle mutation',()=>{
 const f=setup();try{
  expect(f.run(['--apply']).exitCode).toBe(0);const original=readFileSync(join(f.project,late));unlinkSync(join(f.project,late));
  const outside=join(f.base,'outside');writeFileSync(outside,original);symlinkSync(outside,join(f.project,late));
  expect(f.run(['--uninstall','--apply']).exitCode).not.toBe(0);expect(existsSync(join(f.project,wrapper))).toBe(true);
  unlinkSync(join(f.project,late));linkSync(outside,join(f.project,late));
  expect(f.run(['--upgrade','--apply']).exitCode).not.toBe(0);expect(readFileSync(outside).equals(original)).toBe(true);
  unlinkSync(join(f.project,late));writeFileSync(join(f.project,late),original);
  mkdirSync(join(f.project,'.opencode/.office-artifacts.install.lock'));
  expect(f.run(['--uninstall','--apply']).exitCode).not.toBe(0);expect(existsSync(join(f.project,wrapper))).toBe(true);
 }finally{f.cleanup();}
});

test('strict lifecycle arguments reject unknown, repeated and conflicting options',()=>{
 const f=setup();try{
  for(const flags of [['--force'],['--apply','--apply'],['--upgrade','--uninstall'],['--uninstall','--adopt-legacy'],['--project',f.project],['--global'],['junk']])expect(f.run(flags).exitCode).not.toBe(0);
  expect(existsSync(join(f.project,'.opencode'))).toBe(false);
 }finally{f.cleanup();}
});

test('ordinary mid-upgrade rename failure rolls back committed files and cleans staging',()=>{
 const f=setup();try{
  expect(f.run(['--apply']).exitCode).toBe(0);
  const before=readFileSync(join(f.project,skill)),manifest=readFileSync(join(f.project,receipt));
  writeFileSync(join(f.source,'skills/office-artifacts/SKILL.md'),'release two');
  writeFileSync(join(f.source,'skills/office-visual-composition/SKILL.md'),'release two visual');
  // Fault injection exists only in this temporary fixture, never in the real installer.
  const script=join(f.source,'scripts/install-office.ts');
  writeFileSync(script,readFileSync(script,'utf8').replace('writeFileSync,renameSync,unlinkSync','writeFileSync,renameSync as nativeRenameSync,unlinkSync').replace('const args=',"let renameCount=0; function renameSync(from:string,to:string){ if(++renameCount===2)throw new Error('injected rename failure'); nativeRenameSync(from,to); }\nconst args="));
  const result=f.run(['--upgrade','--apply']);expect(result.exitCode).not.toBe(0);expect(result.stderr.toString()).toContain('applied file changes rolled back');
  expect(readFileSync(join(f.project,skill)).equals(before)).toBe(true);expect(readFileSync(join(f.project,receipt)).equals(manifest)).toBe(true);
  expect(existsSync(join(f.project,'.opencode/.office-artifacts.install.lock'))).toBe(false);
  expect(readdirSync(join(f.project,'.opencode'),{recursive:true}).some(name=>String(name).includes('.office-stage-'))).toBe(false);
 }finally{f.cleanup();}
});

test('missing owned files can be repaired and are harmless during uninstall',()=>{
 const f=setup();try{
  expect(f.run(['--apply']).exitCode).toBe(0);unlinkSync(join(f.project,skill));
  expect(f.run(['--upgrade','--apply']).exitCode).toBe(0);expect(existsSync(join(f.project,skill))).toBe(true);
  unlinkSync(join(f.project,skill));const result=f.run(['--uninstall','--apply']);expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout.toString()).missing).toEqual([skill]);expect(existsSync(join(f.project,receipt))).toBe(false);
 }finally{f.cleanup();}
});
