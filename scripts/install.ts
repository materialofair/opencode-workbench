import {existsSync,readFileSync,mkdirSync,writeFileSync,unlinkSync,realpathSync} from 'node:fs';
import {homedir} from 'node:os';import {join,dirname,resolve} from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';
const args=process.argv.slice(2);const projectIndex=args.indexOf('--project');const global=args.includes('--global'),apply=args.includes('--apply'),remove=args.includes('--remove');
if(global===(projectIndex>=0))throw new Error('Choose exactly one: --project /absolute/path or --global');
if(projectIndex>=0 && (!args[projectIndex+1] || args[projectIndex+1].startsWith('--')))throw new Error('Missing project path');
const root=realpathSync(fileURLToPath(new URL('../',import.meta.url)));
const config=global?join(process.env.XDG_CONFIG_HOME||join(homedir(),'.config'),'opencode'):join(realpathSync(resolve(args[projectIndex+1])),'.opencode');
const wrapper=`// Installed by OpenCode Workbench. Remove with the same install script.\nexport { TaskManager } from ${JSON.stringify(pathToFileURL(join(root,'src/plugin.ts')).href)};\n`;
const files=[{path:join(config,'plugins','workbench-tasks.ts'),content:wrapper},{path:join(config,'skills','task-manager','SKILL.md'),content:readFileSync(join(root,'skills/task-manager/SKILL.md'),'utf8')}];
if(!existsSync(join(root,'public','app.js')))throw new Error('Run bun run build first');
// Preflight every target before any mutation. Never overwrite another installation.
for(const f of files)if(existsSync(f.path)&&readFileSync(f.path,'utf8')!==f.content)throw new Error(`Existing file differs; preserve and review it before changing: ${f.path}`);
console.log(JSON.stringify({mode:remove?'uninstall':'install',applied:apply,files:files.map(f=>f.path),changesExistingOpenCodeConfig:false,changesFeishu:false},null,2));
if(apply)for(const f of files){if(remove){if(existsSync(f.path))unlinkSync(f.path);}else if(!existsSync(f.path)){mkdirSync(dirname(f.path),{recursive:true});writeFileSync(f.path,f.content,{mode:0o600,flag:'wx'});}}
