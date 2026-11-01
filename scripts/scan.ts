import {readdirSync,readFileSync,statSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const skip=new Set(['.git','.opencode','.omo','node_modules','.data','artifacts','test-results','playwright-report']);
const findings:{file:string;line:number;rule:string}[]=[];let files=0;
const rules:[string,RegExp][]=[['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],['provider-token',/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/],['user-home-path',/\/Users\/[A-Za-z][^/\s]*\//],['feishu-user-id',/\b(?:ou|oc)_[a-f0-9]{20,}\b/],['credential-assignment',/['"]?(?:appSecret|apiKey|access_token|refresh_token)['"]?\s*[:=]\s*['"][A-Za-z0-9_\/-]{16,}['"]/]];
function walk(dir:string){for(const name of readdirSync(dir)){if(skip.has(name))continue;const file=join(dir,name);if(statSync(file).isDirectory())walk(file);else{
  files++;if(/(?:^|\/)(?:feishu\.json|auth\.json|antigravity-accounts\.json|\.env)(?:$|\.)/.test(file))findings.push({file,line:0,rule:'private-config-name'});
  if(statSync(file).size>2_000_000)continue;
  const lines=readFileSync(file,'utf8').split('\n');lines.forEach((line,i)=>{for(const [rule,re] of rules)if(re.test(line))findings.push({file,line:i+1,rule});});
}}}
walk('.');mkdirSync('artifacts',{recursive:true});const result={files,findings,scope:'Publishable workspace excluding local installation wrappers (.opencode), runtime (including .omo), artifacts, Git, node_modules. Heuristic scan; manual review is still required before publication.'};writeFileSync('artifacts/sensitive-scan.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));if(findings.length)process.exitCode=1;
