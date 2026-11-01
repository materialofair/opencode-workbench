import {copyFileSync,readFileSync,writeFileSync} from 'node:fs';
const result=await Bun.build({entrypoints:['web/app.tsx'],outdir:'public',minify:true,define:{'process.env.NODE_ENV':'"production"'}});
if(!result.success){console.error(result.logs);process.exit(1);}
const notices=['react','react-dom'].map(name=>`${name}\n${readFileSync(`third-party/${name}/LICENSE`,'utf8')}`).join('\n\n');
const js=readFileSync('public/app.js','utf8');writeFileSync('public/app.js','/*! Third-party notices\n'+notices.replaceAll('*/','* /')+'\n*/\n'+js);
copyFileSync('web/index.html','public/index.html');copyFileSync('web/style.css','public/style.css');console.log('Built self-hosted React UI with dependency license notices.');

const plugin=await Bun.build({entrypoints:['src/plugin.ts'],outdir:'dist',target:'node',packages:'external',minify:false});
if(!plugin.success){console.error(plugin.logs);process.exit(1);}
console.log('Built Node-compatible plugin entry for Desktop and Bun CLI.');

const uiTest=await Bun.build({entrypoints:['tests/ui-runner.ts'],outdir:'.data',target:'node',packages:'external'});
if(!uiTest.success){console.error(uiTest.logs);process.exit(1);}

const feishu=await Bun.build({entrypoints:['adapters/feishu/plugin.ts'],outdir:'adapters/feishu',target:'node',packages:'external'});
if(!feishu.success){console.error(feishu.logs);process.exit(1);}
