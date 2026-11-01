import {resolve} from 'node:path';
import {prepare} from './prepare-feishu';
prepare();
const executable=resolve('.data',`bsk-fixture${process.platform==='win32'?'.exe':''}`);
const compile=Bun.spawn([process.execPath,'build','--compile','tests/fixtures/bsk-cli.ts','--outfile',executable],{stdout:'ignore',stderr:'pipe'});
const err=await new Response(compile.stderr).text();if(await compile.exited!==0)throw new Error(err||'Fixture CLI compilation failed');
if(process.platform==='darwin'){const sign=Bun.spawn(['/usr/bin/codesign','--force','--sign','-',executable],{stdout:'ignore',stderr:'pipe'});const detail=await new Response(sign.stderr).text();if(await sign.exited!==0)throw new Error('Cannot sign locally compiled fixture: '+detail);}
const adapter=await Bun.build({entrypoints:['.data/feishu/dist/index.desktop.js'],outdir:'.data/feishu/dist',naming:'index.fixture.js',target:'node',packages:'external',plugins:[{name:'isolated-lark-transport',setup(builder){builder.onResolve({filter:/^@larksuiteoapi\/node-sdk$/},()=>({path:resolve('tests/fixtures/lark-mock.ts')}));}}]});
if(!adapter.success)throw new Error('Fixture Feishu adapter build failed');
const plugin=await Bun.build({entrypoints:['tests/fixtures/browser-plugin.ts'],outdir:'.data',target:'node',packages:'external'});if(!plugin.success)throw new Error('Fixture browser plugin build failed');
const driver=await Bun.build({entrypoints:['scripts/browser-chain.ts'],outdir:'.data',target:'node',packages:'external'});
if(!driver.success){console.error(driver.logs);throw new Error('Browser chain fixture build failed');}
console.log('Built isolated browser-chain fixtures; no production configuration read.');
