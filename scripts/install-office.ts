import {lstatSync,mkdirSync,readFileSync,realpathSync,writeFileSync,renameSync,unlinkSync,rmdirSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const args=process.argv.slice(2),flags=new Set<string>();
let projectArg:string|undefined;
for(let i=0;i<args.length;i++){
 const arg=args[i];
 if(arg==='--project'){
  if(projectArg!==undefined||!args[i+1]||args[i+1].startsWith('--'))throw new Error('Provide --project PATH exactly once');
  projectArg=args[++i];
 }else if(['--apply','--upgrade','--uninstall','--adopt-legacy'].includes(arg)){
  if(flags.has(arg))throw new Error(`Duplicate option: ${arg}`);flags.add(arg);
 }else throw new Error(`Unknown option: ${arg}`);
}
if(!projectArg)throw new Error('Usage: bun scripts/install-office.ts --project PATH [--upgrade | --uninstall] [--adopt-legacy] [--apply]');
if(flags.has('--upgrade')&&flags.has('--uninstall'))throw new Error('Choose only one lifecycle operation');
if(flags.has('--uninstall')&&flags.has('--adopt-legacy'))throw new Error('Adopt exact legacy files before uninstalling');
const project=realpathSync(projectArg),root=resolve(fileURLToPath(new URL('..',import.meta.url)));
if(!lstatSync(project).isDirectory())throw new Error('Project must be a directory');
const mode=flags.has('--uninstall')?'uninstall':flags.has('--upgrade')?'upgrade':'install';
const apply=flags.has('--apply'),receiptPath='.opencode/office-artifacts.install.json',lockPath='.opencode/.office-artifacts.install.lock';
const refs='.opencode/skills/office-visual-composition/references';
const referenceFiles=[
 ['manifest.json','manifest.json'],['ADAPTATION.md','ADAPTATION.md'],
 ['anthropic-frontend-design/SKILL.md','anthropic-frontend-design.md'],['anthropic-frontend-design/LICENSE.txt','anthropic-LICENSE.txt'],
 ['vercel-web-interface/command.md','vercel-web-interface.md'],['vercel-web-interface/LICENSE','vercel-LICENSE'],
 ['ui-ux-pro-max/LICENSE','ui-ux-pro-max/LICENSE'],['ui-ux-pro-max/scripts/core.py','ui-ux-pro-max/scripts/core.py'],
 ...['styles','colors','charts','typography','landing','products','ux-guidelines','app-interface'].map(name=>[`ui-ux-pro-max/data/${name}.csv`,`ui-ux-pro-max/data/${name}.csv`]),
];
const pluginPath='.opencode/plugins/office-artifacts.js',skills=['office-artifacts','office-visual-composition'];
const allowed=new Set([pluginPath,...skills.map(name=>`.opencode/skills/${name}/SKILL.md`),...referenceFiles.map(([,target])=>`${refs}/${target}`)]);
const absolute=(relative:string)=>join(project,...relative.split('/'));
const sha=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
function stat(path:string){try{return lstatSync(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}}
function safe(relative:string){
 let cursor=absolute(relative);
 while(cursor!==project){
  const info=stat(cursor);
  if(info?.isSymbolicLink())throw new Error(`Refusing symbolic link or junction: ${cursor}`);
  if(cursor!==absolute(relative)&&info&&!info.isDirectory())throw new Error(`Parent is not a directory: ${cursor}`);
  const parent=dirname(cursor);if(parent===cursor)throw new Error('Path outside project');cursor=parent;
 }
}
function read(relative:string):Buffer|undefined{
 safe(relative);const path=absolute(relative),info=stat(path);
 if(!info)return undefined;
 if(!info.isFile()||info.nlink!==1)throw new Error(`Expected a regular, non-hardlinked file: ${path}`);
 if(info.size>2_000_000)throw new Error(`Managed file exceeds 2 MB: ${path}`);
 return readFileSync(path);
}
type RecordFile={path:string;sha256:string;bytes:number};
type Receipt={schema:1;owner:'office-artifacts';installation:'linked-source';sourceRoot:string;sourceAdapterSha256:string;files:RecordFile[]};
function parseReceipt(raw:Buffer|undefined):Receipt|undefined{
 if(!raw)return undefined;
 if(raw.length>128_000)throw new Error('Installation manifest exceeds budget');
 const value=JSON.parse(raw.toString('utf8')) as Receipt;
 if(!value||value.schema!==1||value.owner!=='office-artifacts'||value.installation!=='linked-source'||typeof value.sourceRoot!=='string'||typeof value.sourceAdapterSha256!=='string'||!/^[a-f0-9]{64}$/.test(value.sourceAdapterSha256)||!Array.isArray(value.files)||value.files.length>allowed.size)throw new Error('Invalid office installation manifest');
 const seen=new Set<string>();
 for(const file of value.files){
  if(!file||!allowed.has(file.path)||seen.has(file.path)||typeof file.sha256!=='string'||!/^[a-f0-9]{64}$/.test(file.sha256)||!Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>2_000_000)throw new Error('Invalid or out-of-scope manifest file');
  seen.add(file.path);
 }
 return value;
}
const targets=new Map<string,Buffer>();let adapterHash='';
if(mode!=='uninstall'){
 const plugin=join(root,'adapters/office/plugin.js');
 if(!stat(plugin)?.isFile())throw new Error('Build office adapter first: bun scripts/build-office.ts');
 adapterHash=sha(readFileSync(plugin));
 targets.set(pluginPath,Buffer.from(`export { OfficeArtifacts as default } from ${JSON.stringify(pathToFileURL(plugin).href)};\n`));
 for(const name of skills)targets.set(`.opencode/skills/${name}/SKILL.md`,readFileSync(join(root,`skills/${name}/SKILL.md`)));
 for(const [source,target] of referenceFiles)targets.set(`${refs}/${target}`,readFileSync(join(root,'third-party/design-skills',source)));
 for(const value of targets.values())if(value.length>2_000_000)throw new Error('Source file exceeds installation budget');
}
type Change={path:string;before:Buffer|undefined;after:Buffer|undefined};
function plan(){
 safe(lockPath);if(stat(absolute(lockPath)))throw new Error('Another install may be running; inspect the existing lock before retrying');
 const receiptBefore=read(receiptPath),receipt=parseReceipt(receiptBefore);
 const current=new Map<string,Buffer|undefined>();
 for(const path of allowed)current.set(path,read(path));
 const snapshots:Change[]=[...current].map(([path,before])=>({path,before,after:before}));
 snapshots.push({path:receiptPath,before:receiptBefore,after:receiptBefore});
 const changes:Change[]=[],preserved:string[]=[],missing:string[]=[];
 let next:Receipt|undefined;
 if(mode==='uninstall'){
  if(!receipt)return {changes,preserved,missing,snapshots,status:'not-installed'};
  const retained:RecordFile[]=[];
  for(const file of receipt.files){
   const before=current.get(file.path);
   if(!before){missing.push(file.path);continue;}
   if(sha(before)!==file.sha256||before.length!==file.bytes){preserved.push(file.path);retained.push(file);continue;}
   changes.push({path:file.path,before,after:undefined});
  }
  if(retained.length)next={...receipt,files:retained};
 }else{
  if(flags.has('--adopt-legacy')&&receipt)throw new Error('Installation already has a manifest; remove --adopt-legacy');
  if(receipt&&mode!=='upgrade'&&(receipt.sourceRoot!==root||receipt.sourceAdapterSha256!==adapterHash))throw new Error('Linked source or adapter changed; review --upgrade before updating the manifest');
  const owned=new Map(receipt?.files.map(file=>[file.path,file])??[]);
  if(!receipt&&[...current.values()].some(Boolean)&&!flags.has('--adopt-legacy'))throw new Error('Legacy or unowned files exist. Review them, then use --adopt-legacy only if they exactly match this release');
  for(const [path,after] of targets){
   const before=current.get(path),record=owned.get(path);
   if(before&&record&&(sha(before)!==record.sha256||before.length!==record.bytes))throw new Error(`User-modified file preserved; no changes made: ${path}`);
   if(before&&!record&&!before.equals(after))throw new Error(`Unowned or legacy file differs; no changes made: ${path}`);
   if(before&&!record&&receipt)throw new Error(`Unowned file preserved; no changes made: ${path}`);
   if(before&&!before.equals(after)&&mode!=='upgrade')throw new Error('Installed release differs; use --upgrade after reviewing the dry-run');
   if(!before||!before.equals(after))changes.push({path,before,after});
  }
  next={schema:1,owner:'office-artifacts',installation:'linked-source',sourceRoot:root,sourceAdapterSha256:adapterHash,files:[...targets].map(([path,value])=>({path,sha256:sha(value),bytes:value.length}))};
 }
 const after=next?Buffer.from(JSON.stringify(next,null,2)+'\n'):undefined;
 if((receiptBefore&&!after)||(!receiptBefore&&after)||(receiptBefore&&after&&!receiptBefore.equals(after)))changes.push({path:receiptPath,before:receiptBefore,after});
 return {changes,preserved,missing,snapshots,status:preserved.length?'preserved-modifications':'ready'};
}
const prepared=plan();let applied=false;
if(apply&&prepared.changes.length){
 // Cooperative lock, not an OS sandbox or protection from a hostile local writer.
 mkdirSync(absolute('.opencode'),{recursive:true});safe(lockPath);mkdirSync(absolute(lockPath));
 const staged=new Map<string,string>(),committed:Change[]=[];
 const assertUnchanged=(change:Change)=>{
  const now=read(change.path);
  if((now===undefined)!==(change.before===undefined)||(now&&change.before&&!now.equals(change.before)))throw new Error(`File changed during installation: ${change.path}`);
 };
 try{
  for(const snapshot of prepared.snapshots)assertUnchanged(snapshot);
  for(const change of prepared.changes)if(change.after){
   safe(change.path);mkdirSync(dirname(absolute(change.path)),{recursive:true});
   const temp=absolute(change.path)+`.office-stage-${randomUUID()}`;
   staged.set(change.path,temp);writeFileSync(temp,change.after,{flag:'wx',mode:0o600});
  }
  for(const change of prepared.changes){
   assertUnchanged(change);
   if(change.after)renameSync(staged.get(change.path)!,absolute(change.path));
   else unlinkSync(absolute(change.path));
   committed.push(change);
  }
  applied=true;
 }catch(error){
  // Restore only destinations still equal to our writes, never clobber a concurrent edit.
  const failures:string[]=[];
  for(const change of committed.reverse())try{
   const now=read(change.path);
   if((now===undefined)!==(change.after===undefined)||(now&&change.after&&!now.equals(change.after)))throw new Error('Concurrent edit');
   if(change.before){
    const temp=absolute(change.path)+`.office-rollback-${randomUUID()}`;
    try{writeFileSync(temp,change.before,{flag:'wx',mode:0o600});renameSync(temp,absolute(change.path));}finally{if(stat(temp))unlinkSync(temp);}
   }else if(now)unlinkSync(absolute(change.path));
  }catch{failures.push(change.path);}
  throw new Error(`${String(error)}${failures.length?`; rollback incomplete, inspect: ${failures.join(', ')}`:'; applied file changes rolled back'}`);
 }finally{
  for(const temp of staged.values())if(stat(temp))unlinkSync(temp);
  rmdirSync(absolute(lockPath));
 }
}
console.log(JSON.stringify({mode,apply,applied,project,status:prepared.status,files:prepared.changes.map(change=>absolute(change.path)),changes:prepared.changes.map(change=>({path:change.path,action:change.after?(change.before?'replace':'create'):'remove'})),preserved:prepared.preserved,missing:prepared.missing,sourceDependency:mode==='uninstall'?undefined:root,note:'Project-local linked-source installation. Keep the source checkout and its offline Python/runtime dependencies. No model, permissions, global config, PPT skills or user data directories are changed.'},null,2));
