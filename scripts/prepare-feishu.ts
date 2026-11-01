import {readFileSync,mkdirSync,writeFileSync,copyFileSync,cpSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
export function applyPatch(source:string,patch:string) {
  const original=source.split('\n'),out:string[]=[];let cursor=0;
  const lines=patch.split('\n');
  for(let i=0;i<lines.length;i++) {
    const h=lines[i].match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);if(!h)continue;
    const start=Number(h[1])-1;if(start<cursor)throw new Error('Overlapping patch hunk');out.push(...original.slice(cursor,start));cursor=start;
    for(i++;i<lines.length&&!lines[i].startsWith('@@ ');i++) {
      const line=lines[i];if(!line || line.startsWith('\\'))continue;
      if(line[0]===' '||line[0]==='-') {if(original[cursor]!==line.slice(1))throw new Error(`Patch source mismatch at line ${cursor+1}`);cursor++;}
      if(line[0]===' '||line[0]==='+')out.push(line.slice(1));
    }
    i--;
  }
  out.push(...original.slice(cursor));return out.join('\n')+'\n';
}
export function prepare() {
  const root=fileURLToPath(new URL('../',import.meta.url));
  const upstream=dirname(fileURLToPath(import.meta.resolve('opencode-feishu')));
  const source=readFileSync(join(upstream,'index.js'),'utf8');
  const p=JSON.parse(readFileSync(join(root,'third-party/opencode-feishu/provenance.json'),'utf8'));
  const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
  if(hash(source)!==p.upstreamBundleSha256)throw new Error('Upstream bundle hash mismatch; review version before adapting');
  const adapted=applyPatch(source,readFileSync(join(root,'adapters/feishu/desktop.patch'),'utf8'));
  if(hash(adapted)!==p.localAdaptedBundleSha256)throw new Error('Adapted bundle hash mismatch');
  // New project safeguards are separate from the preserved historical desktop diff.
  let result=adapted.replace('const configPath = join(homedir(), ".config", "opencode", "plugins", "feishu.json");','const configPath = process.env.OPENCODE_WORKBENCH_FEISHU_CONFIG || join(homedir(), ".config", "opencode", "plugins", "feishu.json");');
  result=result.replace('  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;','  if (process.env.OPENCODE_WORKBENCH_FEISHU_TELEMETRY !== "1") return;\n  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;');
  // Keep the upstream/local historical hash chain intact; apply this new
  // Windows-only owner guard after verifying the preserved adaptation.
  result=result.replace('realpathSync(resolvedConfig.directory) !== realpathSync(ctx.directory)', '(process.platform === "win32" ? realpathSync(resolvedConfig.directory).toLowerCase() !== realpathSync(ctx.directory).toLowerCase() : realpathSync(resolvedConfig.directory) !== realpathSync(ctx.directory))');
  const target=join(root,'.data','feishu');mkdirSync(join(target,'dist'),{recursive:true,mode:0o700});
  writeFileSync(join(target,'dist','index.desktop.js'),result,{mode:0o600});
  copyFileSync(join(root,'adapters/feishu/compact-markdown.mjs'),join(target,'dist','compact-markdown.mjs'));
  cpSync(join(upstream,'..','prompts'),join(target,'prompts'),{recursive:true});
  console.log('Prepared pinned upstream Feishu adapter locally; no configuration read or gateway started.');
}
if(import.meta.main)prepare();
