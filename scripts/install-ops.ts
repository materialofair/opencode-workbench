import {existsSync,readFileSync,mkdirSync,writeFileSync,unlinkSync,realpathSync,lstatSync,readdirSync} from 'node:fs';
import {homedir} from 'node:os';import {join,dirname,resolve} from 'node:path';import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2);const projectIndex=args.indexOf('--project');const global=args.includes('--global'),apply=args.includes('--apply'),remove=args.includes('--remove');
if(global===(projectIndex>=0))throw new Error('Choose exactly one: --project /absolute/path or --global');
if(projectIndex>=0 && (!args[projectIndex+1] || args[projectIndex+1].startsWith('--')))throw new Error('Missing project path');
const root=realpathSync(fileURLToPath(new URL('../',import.meta.url)));
const config=global?join(process.env.XDG_CONFIG_HOME||join(homedir(),'.config'),'opencode'):join(realpathSync(resolve(args[projectIndex+1])),'.opencode');
// Copy the entire selected skill, including upstream references and license.
const files: {path:string;content:string}[]=[];
function collect(source:string,target:string){
  for(const entry of readdirSync(source,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    const from=join(source,entry.name),to=join(target,entry.name);
    if(entry.isSymbolicLink())throw new Error('Skill source must not contain symbolic links');
    if(entry.isDirectory())collect(from,to);
    else if(entry.isFile())files.push({path:to,content:readFileSync(from,'utf8')});
    else throw new Error('Unsupported skill source entry');
  }
}
for(const name of ['devops-engineer','sre-engineer','monitoring-expert']){
  collect(join(root,'skills',name),join(config,'skills',name));
}
// Preflight every target before any mutation. Never overwrite another installation.
for(const f of files){
  for(let path=f.path;path!==dirname(config);path=dirname(path)){
    try{
      const stat=lstatSync(path);
      if(stat.isSymbolicLink())throw new Error('Refusing installation through a symbolic link or Windows junction');
      if(path===f.path?!stat.isFile():!stat.isDirectory())throw new Error(`Unexpected target type: ${path}`);
    }
    catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    if(path===dirname(path))break;
  }
}
for(const f of files)if(existsSync(f.path)&&readFileSync(f.path,'utf8')!==f.content)throw new Error(`Existing file differs; preserve and review it before changing: ${f.path}`);
console.log(JSON.stringify({mode:remove?'uninstall':'install',applied:apply,files:files.map(f=>f.path),changesExistingOpenCodeConfig:false,changesFeishu:false,requiresBuild:false},null,2));
if(apply)for(const f of files){if(remove){if(existsSync(f.path))unlinkSync(f.path);}else if(!existsSync(f.path)){mkdirSync(dirname(f.path),{recursive:true});writeFileSync(f.path,f.content,{mode:0o600,flag:'wx'});}}
