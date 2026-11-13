import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const args=process.argv.slice(2), p=args.indexOf('--project');
if(p<0 || !args[p+1]) throw new Error('Usage: bun scripts/install-office.ts --project PATH [--apply]');
const project=realpathSync(args[p+1]), root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const plugin=join(root,'adapters/office/plugin.js');
if(!existsSync(plugin)) throw new Error('Build office adapter first: bun scripts/build-office.ts');
const targets=[
  [join(project,'.opencode/plugins/office-artifacts.js'),`export { OfficeArtifacts as default } from ${JSON.stringify(pathToFileURL(plugin).href)};\n`],
  [join(project,'.opencode/skills/office-artifacts/SKILL.md'),readFileSync(join(root,'skills/office-artifacts/SKILL.md'),'utf8')],
  [join(project,'.opencode/skills/office-visual-composition/SKILL.md'),readFileSync(join(root,'skills/office-visual-composition/SKILL.md'),'utf8')],
];
const refs=join(project,'.opencode/skills/office-visual-composition/references');
const referenceFiles=[
 ['manifest.json','manifest.json'],['ADAPTATION.md','ADAPTATION.md'],
 ['anthropic-frontend-design/SKILL.md','anthropic-frontend-design.md'],
 ['anthropic-frontend-design/LICENSE.txt','anthropic-LICENSE.txt'],
 ['vercel-web-interface/command.md','vercel-web-interface.md'],
 ['vercel-web-interface/LICENSE','vercel-LICENSE'],
 ['ui-ux-pro-max/LICENSE','ui-ux-pro-max/LICENSE'],
 ['ui-ux-pro-max/scripts/core.py','ui-ux-pro-max/scripts/core.py'],
 ...['styles','colors','charts','typography','landing','products','ux-guidelines','app-interface'].map(name=>[`ui-ux-pro-max/data/${name}.csv`,`ui-ux-pro-max/data/${name}.csv`]),
];
for(const [source,target] of referenceFiles)targets.push([join(refs,target),readFileSync(join(root,'third-party/design-skills',source),'utf8')]);
// lstat also detects dangling symlinks, unlike existsSync.
function isLink(path:string){try{return lstatSync(path).isSymbolicLink();}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}}
for(const [path] of targets){let cursor=path;while(cursor!==project){if(isLink(cursor))throw new Error(`Refusing symbolic link: ${cursor}`);const parent=dirname(cursor);if(parent===cursor)throw new Error('Path outside project');cursor=parent;}}
for(const [path,content] of targets) if(existsSync(path)&&readFileSync(path,'utf8')!==content) throw new Error(`Refusing to replace existing file: ${path}`);
console.log(JSON.stringify({apply:args.includes('--apply'),project,files:targets.map(([path])=>path),note:'No model, permissions, global config or PPT skills are changed.'},null,2));
if(args.includes('--apply'))for(const [path,content] of targets){if(existsSync(path))continue;mkdirSync(dirname(path),{recursive:true});writeFileSync(path,content,{flag:'wx',mode:0o600});}
