import {win32,posix} from 'node:path';
import {mkdirSync,chmodSync,statSync} from 'node:fs';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';

export function directoryKey(directory:string,platform=process.platform){
  if(platform!=='win32')return directory; // Preserve existing macOS/Linux DB identities.
  const normal=win32.normalize(directory).replace(/^\\\\\?\\UNC\\/i,'\\\\').replace(/^\\\\\?\\/,'');
  return normal.toLowerCase(); // Standard case-insensitive Windows project directories.
}
// Inputs are already resolved by the plugin owner checks. On Windows, Node
// and the native host can still spell one NTFS directory with long/8.3 aliases.
// Accept an alias only with an exact, nonzero device+file identity; never guess.
type DirectoryIdentity=(path:string)=>{dev:bigint;ino:bigint;isDirectory:()=>boolean};
export function sameOwnerDirectory(left:string,right:string,platform=process.platform,identify:DirectoryIdentity=path=>statSync(path,{bigint:true})){
  if(directoryKey(left,platform)===directoryKey(right,platform))return true;
  if(platform!=='win32')return false;
  try{const a=identify(left),b=identify(right);return a.isDirectory()&&b.isDirectory()&&a.dev!==0n&&a.ino!==0n&&a.dev===b.dev&&a.ino===b.ino;}catch{return false;}
}
export function projectID(directory:string,platform=process.platform){return createHash('sha256').update(directoryKey(directory,platform)).digest('hex').slice(0,24);}
export function stateDirectory(directory:string,env:NodeJS.ProcessEnv=process.env,home=homedir(),platform=process.platform){
  const path=platform==='win32'?win32:posix;
  const base=env.XDG_STATE_HOME || (platform==='win32'?(env.LOCALAPPDATA||path.join(home,'AppData','Local')):path.join(home,'.local','state'));
  return path.join(base,'opencode-workbench',projectID(directory,platform));
}
export function expandOwnerDirectory(value:string,env:NodeJS.ProcessEnv=process.env,home=homedir()){
  return value.replace(/^~(?=[\\/]|$)/,()=>home).replace(/\$\{(\w+)\}/g,(_:string,key:string)=>env[key]??'');
}
type Run=(file:string,args:string[])=>string;
const run:Run=(file,args)=>execFileSync(file,args,{encoding:'utf8',windowsHide:true,timeout:10000,stdio:['ignore','pipe','pipe']});
function systemExecutable(name:string,env:NodeJS.ProcessEnv){
  if(!env.SystemRoot||!win32.isAbsolute(env.SystemRoot))throw new Error('Windows SystemRoot is unavailable');
  return win32.join(env.SystemRoot,'System32',name);
}
// Only this plugin's per-project state directory is changed; never the profile,
// project, global OpenCode configuration, or another application's directory.
export function protectStateDirectory(directory:string,platform=process.platform,env:NodeJS.ProcessEnv=process.env,execute:Run=run){
  mkdirSync(directory,{recursive:true,mode:0o700});
  if(platform!=='win32'){chmodSync(directory,0o700);return;}
  try{
    const identity=execute(systemExecutable('whoami.exe',env),['/user','/fo','csv','/nh']);
    const sid=identity.match(/\bS-\d-\d+(?:-\d+)+\b/)?.[0];
    if(!sid)throw new Error('Windows user SID unavailable');
    const icacls=systemExecutable('icacls.exe',env);
    execute(icacls,[directory,'/reset','/q']);
    execute(icacls,[directory,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F','/q']);
  }catch{throw new Error('Cannot protect task state with Windows ACL; use a private local NTFS directory. No scheduler was started.');}
}
export function browserCommand(url:string,platform=process.platform,env:NodeJS.ProcessEnv=process.env){
  const u=new URL(url);
  if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.pathname!=='/'||!/^#[A-Za-z0-9_-]{16,}$/.test(u.hash))throw new Error('Invalid local task manager URL');
  return platform==='darwin'?{file:'/usr/bin/open',args:[url]}:platform==='win32'?{file:systemExecutable('rundll32.exe',env),args:[systemExecutable('url.dll',env)+',FileProtocolHandler',url]}:{file:'xdg-open',args:[url]};
}
export async function openBrowser(url:string){
  const {file,args}=browserCommand(url);
  await new Promise<void>((resolve,reject)=>{
    const child=spawn(file,args,{stdio:'ignore',shell:false,windowsHide:true});
    const timer=setTimeout(()=>{child.kill();reject(new Error('本机浏览器启动超时，请检查默认浏览器后再次调用'));},10000);
    child.once('error',()=>{clearTimeout(timer);reject(new Error('本机浏览器启动失败'));});
    child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new Error('无法打开默认浏览器，请检查本机浏览器后再次调用'));});
  });
}
