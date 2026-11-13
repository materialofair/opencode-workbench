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
];
for(const [path] of targets){let cursor=path;while(cursor!==project){if(existsSync(cursor)&&lstatSync(cursor).isSymbolicLink())throw new Error(`Refusing symbolic link: ${cursor}`);const parent=dirname(cursor);if(parent===cursor)throw new Error('Path outside project');cursor=parent;}}
for(const [path,content] of targets) if(existsSync(path)&&readFileSync(path,'utf8')!==content) throw new Error(`Refusing to replace existing file: ${path}`);
console.log(JSON.stringify({apply:args.includes('--apply'),project,files:targets.map(([path])=>path),note:'No model, permissions, global config or PPT skills are changed.'},null,2));
if(args.includes('--apply'))for(const [path,content] of targets){if(existsSync(path))continue;mkdirSync(dirname(path),{recursive:true});writeFileSync(path,content,{flag:'wx',mode:0o600});}
