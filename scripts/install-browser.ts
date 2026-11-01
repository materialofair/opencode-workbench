import {existsSync,readFileSync,mkdirSync,writeFileSync,unlinkSync,realpathSync,lstatSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2),index=args.indexOf('--project'),apply=args.includes('--apply'),remove=args.includes('--remove');
if(index<0||!args[index+1]||args[index+1].startsWith('--'))throw new Error('Use --project /absolute/existing/project, then optionally --apply or --remove');
const root=realpathSync(fileURLToPath(new URL('../',import.meta.url))),project=realpathSync(resolve(args[index+1]));
const config=join(project,'.opencode'),entry=join(root,'adapters','browser','plugin.js');
if(!existsSync(entry))throw new Error('Run bun run build before installing the browser integration');
const hash=createHash('sha256').update(readFileSync(entry)).digest('hex').slice(0,12);
const wrapper=`// Installed by OpenCode Workbench Browser. Remove with the same install-browser script.\nexport { BrowserTools } from ${JSON.stringify(pathToFileURL(entry).href+'?v='+hash)};\n`;
const files=[{path:join(config,'plugins','workbench-browser.js'),content:wrapper},{path:join(config,'skills','feishu-browser','SKILL.md'),content:readFileSync(join(root,'skills','feishu-browser','SKILL.md'),'utf8')}];
for(const f of files){
  for(let path=f.path;path!==dirname(config);path=dirname(path)){
    try{if(lstatSync(path).isSymbolicLink())throw new Error('Refusing browser installation through a symbolic link or junction');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    if(path===dirname(path))break;
  }
  if(existsSync(f.path)&&readFileSync(f.path,'utf8')!==f.content)throw new Error('Existing browser integration file differs; preserve it and use its original installer to uninstall first');
}
console.log(JSON.stringify({mode:remove?'uninstall':'install',applied:apply,files:files.map(f=>f.path),changesBrowserSkill:false,changesFeishu:false,createsConfiguration:false},null,2));
if(apply)for(const f of files){if(remove){if(existsSync(f.path))unlinkSync(f.path);}else if(!existsSync(f.path)){mkdirSync(dirname(f.path),{recursive:true});writeFileSync(f.path,f.content,{mode:0o600,flag:'wx'});}}
