import {spawn} from 'node:child_process';
import {existsSync,lstatSync,realpathSync,statSync,readFileSync} from 'node:fs';
import {basename,delimiter,dirname,extname,isAbsolute,join,relative,win32} from 'node:path';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('../../office/qa-html.mjs',import.meta.url));
const inside=(root:string,path:string)=>{const rel=relative(root,path);return rel===''||(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+(process.platform==='win32'?'\\':'/')));};
function segments(path:string){if(typeof path!=='string'||!path||path.length>4096||path.includes('\0')||isAbsolute(path)||win32.isAbsolute(path)||path.split(/[\\/]/).some(p=>p==='..'||p===''))throw new Error('Expected bounded project-relative path without empty or parent segments');return path.split(/[\\/]/);}
export function validateHtmlPaths(root:string,input:string,output:string){
 root=realpathSync(root);const inputPath=realpathSync(join(root,...segments(input)));
 if(!inside(root,inputPath)||!statSync(inputPath).isFile()||extname(inputPath).toLowerCase()!=='.html')throw new Error('HTML input must be an existing .html file inside the project');
 const proposed=join(root,...segments(output));const parent=realpathSync(dirname(proposed));
 if(!inside(root,parent))throw new Error('Evidence directory parent escapes project');
 const outputPath=join(parent,basename(proposed));
 try{lstatSync(outputPath);throw new Error('Evidence directory already exists; use a new path');}catch(e:any){if(e.code!=='ENOENT')throw e;}
 return {root,inputPath,outputPath};
}
function nodeExecutable(){const configured=process.env.OPENCODE_OFFICE_NODE;if(configured){if(!isAbsolute(configured)||!existsSync(configured))throw new Error('OPENCODE_OFFICE_NODE must identify a preinstalled absolute Node executable');return realpathSync(configured);}if(/^node(?:\.exe)?$/i.test(basename(process.execPath)))return process.execPath;for(const dir of (process.env.PATH??'').split(delimiter)){if(!isAbsolute(dir))continue;const candidate=join(dir,process.platform==='win32'?'node.exe':'node');if(existsSync(candidate)&&statSync(candidate).isFile())return realpathSync(candidate);}throw new Error('Preinstalled Node unavailable; no runtime download attempted');}
function environment():NodeJS.ProcessEnv{const env:NodeJS.ProcessEnv={};for(const key of ['PATH','HOME','TMPDIR','TEMP','TMP','SystemRoot','SYSTEMROOT','WINDIR','LANG','LC_ALL','PLAYWRIGHT_BROWSERS_PATH','PLAYWRIGHT_CHROMIUM_EXECUTABLE'])if(process.env[key]!==undefined)env[key]=process.env[key];return env;}
export async function executeHtmlValidation(root:string,input:string,output:string,signal?:AbortSignal,mode:'static'|'first-party-table'='static'):Promise<string>{
 const failed=(status:string,error:string)=>JSON.stringify({ok:false,status,error:error.slice(0,2048),evidence_directory:output,warning:'Inspect partial evidence before retry; use a new output directory.'});
 if(signal?.aborted)return failed('cancelled','Validation cancelled before execution');
 if(!['static','first-party-table'].includes(mode))return failed('unsupported','Only static and fixed first-party-table validation modes are supported');
 let paths:ReturnType<typeof validateHtmlPaths>,node:string;
 try{paths=validateHtmlPaths(root,input,output);node=nodeExecutable();}catch(error){return failed('failed',String(error));}
 return new Promise(resolve=>{
  const child=spawn(node,[script,paths.inputPath,paths.outputPath,'--timeout-ms','90000',...(mode==='static'?[]:['--mode',mode])],{cwd:paths.root,shell:false,detached:process.platform!=='win32',env:environment(),stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='',terminal:string|undefined,settled=false;let forceTimer:ReturnType<typeof setTimeout>|undefined;
  const finish=(value:string)=>{if(settled)return;settled=true;clearTimeout(timer);if(forceTimer)clearTimeout(forceTimer);signal?.removeEventListener('abort',cancel);resolve(value);};
  const stop=(reason:string)=>{if(terminal)return;terminal=reason;
   if(child.pid){if(process.platform==='win32'){const system=process.env.SystemRoot||process.env.SYSTEMROOT;if(system){const killer=spawn(join(system,'System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{shell:false,stdio:'ignore',env:environment()});killer.on('error',()=>child.kill('SIGKILL'));}else child.kill('SIGKILL');}else{try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}}}
   forceTimer=setTimeout(()=>finish(failed('failed',reason+'; process termination could not be confirmed')),3000);
  };
  const cancel=()=>stop('Validation cancelled');signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(()=>stop('Validation exceeded 95 second host deadline'),95000);
  child.stdout.on('data',chunk=>{if(terminal)return;stdout+=chunk;if(Buffer.byteLength(stdout)>1048576)stop('Validation report exceeds 1 MiB');});
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(0,2048);});
  child.on('error',error=>finish(failed('failed',String(error))));
  child.on('close',code=>{
   if(terminal){finish(failed(terminal.includes('cancelled')?'cancelled':'failed',terminal));return;}
   try{const result=JSON.parse(stdout);if(result.version!==2||typeof result.passed!=='boolean'||!Array.isArray(result.evidence)||!['passed','failed','blocked','unsupported','limited'].includes(result.status))throw new Error('Invalid QA result schema');if(result.mode!==mode)throw new Error('QA mode differs from requested mode');if((code===0)!==result.passed)throw new Error('QA exit/result mismatch');for(const e of result.evidence)if(typeof e.filename!=='string'||basename(e.filename)!==e.filename||/[\\/]/.test(e.filename))throw new Error('Unsafe evidence filename');
    if(result.passed){
      if(!existsSync(paths.outputPath)||lstatSync(paths.outputPath).isSymbolicLink()||!statSync(paths.outputPath).isDirectory())throw new Error('Missing or unsafe evidence directory');
      const canonical=realpathSync(paths.outputPath);if(!inside(paths.root,canonical))throw new Error('Evidence directory escapes project');
      for(const item of [{filename:'report.json',max:1048576},...result.evidence.map((e:any)=>({filename:e.filename,max:16777216,bytes:e.bytes}))]){
        const file=join(canonical,item.filename),info=lstatSync(file);if(!info.isFile()||info.isSymbolicLink()||!inside(canonical,realpathSync(file))||info.size>item.max||('bytes' in item&&info.size!==item.bytes))throw new Error('Missing, unsafe or inconsistent evidence file: '+item.filename);
      }
      if(JSON.stringify(JSON.parse(readFileSync(join(canonical,'report.json'),'utf8')))!==JSON.stringify(result))throw new Error('Persisted QA report differs from stdout');
    }
    finish(JSON.stringify({ok:result.passed,status:result.status,evidence_directory:output,report:result}));}catch(error){finish(failed('failed',`Invalid validation response (${code}): ${String(error)} ${stderr}`));}
  });
  if(signal?.aborted)cancel();
 });
}
