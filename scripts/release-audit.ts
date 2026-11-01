import {execFileSync} from 'node:child_process';
import {lstatSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

// No network or credential access. Inspect every local Git object, including
// reflog-only/unreachable history, plus tracked and non-ignored working files.
const git=(...args:string[])=>execFileSync('git',args,{maxBuffer:64*1024*1024});
const rules:[string,RegExp][]=[
  ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['provider-token',/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/],
  ['cloud-access-key',/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['credential-assignment',/['"]?(?:appSecret|apiKey|access_token|refresh_token|client_secret|password)['"]?\s*[:=]\s*['"][A-Za-z0-9_\/-]{16,}['"]/],
  ['user-home-path',/(?:\/Users\/[A-Za-z][^/\s]*\/|\/home\/[A-Za-z][^/\s]*\/|[A-Z]:\\Users\\[^\\\s]+\\)/],
  ['feishu-identity',/\b(?:ou|oc|cli)_[a-f0-9]{20,}\b/],
  ['opencode-session-id',/\bses_[A-Za-z0-9]{20,}\b/],
  ['url-credentials',/https?:\/\/[^\s\/@:]+:[^\s\/@]+@/],
  ['private-lan-address',/\b(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/]
];
type Finding={scope:string;target:string;line:number;rule:string};
const findings:Finding[]=[];
function scan(scope:string,target:string,data:Buffer){
  if(data.includes(0)){findings.push({scope,target,line:0,rule:'binary-content'});return;}
  data.toString('utf8').split('\n').forEach((line,i)=>{
    for(const [rule,re] of rules)if(re.test(line))findings.push({scope,target,line:i+1,rule});
  });
}
const forbidden=/(?:^|\/)(?:node_modules|artifacts|\.data|\.opencode|\.omo|test-results|playwright-report)(?:\/|$)|(?:^|\/)(?:feishu\.json|auth\.json|antigravity-accounts\.json|\.env)(?:\.|$)|\.(?:db(?:-.*)?|sqlite\w*|log|tgz|zip|dylib|node|exe)$/;
const objects=git('cat-file','--batch-all-objects','--batch-check=%(objectname) %(objecttype)').toString().trim().split('\n').filter(Boolean);
let blobs=0,commits=0,tags=0;
for(const object of objects){
  const [oid,type]=object.split(' ');
  if(type==='blob'){blobs++;scan('git-blob',oid,git('cat-file','blob',oid));}
  if(type==='commit'||type==='tag'){
    if(type==='commit')commits++;else tags++;
    scan('git-'+type,oid,git('cat-file',type,oid));
    if(type==='commit')for(const path of git('ls-tree','-r','--name-only','-z',oid).toString().split('\0').filter(Boolean)){
      if(forbidden.test(path))findings.push({scope:'git-path',target:oid+':'+path,line:0,rule:'private-or-runtime-path'});
      scan('git-path',oid+':'+path,Buffer.from(path));
    }
  }
}
const paths=git('ls-files','-z','--cached','--others','--exclude-standard').toString().split('\0').filter(Boolean);
const inventory:{path:string;bytes:number;sha256:string}[]=[];
for(const path of paths){
  const stat=lstatSync(path);
  if(!stat.isFile()){findings.push({scope:'working-tree',target:path,line:0,rule:'nonregular-file'});continue;}
  if(forbidden.test(path))findings.push({scope:'working-tree',target:path,line:0,rule:'private-or-runtime-path'});
  const bytes=readFileSync(path);scan('working-tree',path,bytes);
  inventory.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
const result={schema:1,head:git('rev-parse','HEAD').toString().trim(),
  scope:'All objects in the local Git object database (including unreachable objects), commit/tag metadata, every historical path, and tracked/non-ignored working files; ignored local runtime and dependencies are excluded from the publishable tree.',
  counts:{objects:objects.length,commits,tags,uniqueBlobs:blobs,workingFiles:inventory.length},
  findings,inventory,limitations:'Heuristic patterns are not a security audit or proof of absence. Arbitrary prose, emails, phone numbers, custom credentials and upstream-owned examples still require manual review. No credentials or matching values are printed.'};
mkdirSync('artifacts',{recursive:true});
writeFileSync('artifacts/release-audit.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({head:result.head,counts:result.counts,findings,report:'artifacts/release-audit.json',limitations:result.limitations},null,2));
if(findings.length)process.exitCode=1;
