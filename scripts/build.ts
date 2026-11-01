import {copyFileSync,readFileSync,writeFileSync} from 'node:fs';
const result=await Bun.build({entrypoints:['web/app.tsx'],outdir:'public',minify:true,define:{'process.env.NODE_ENV':'"production"'}});
if(!result.success){console.error(result.logs);process.exit(1);}
const notices=['react','react-dom'].map(name=>`${name}\n${readFileSync(`third-party/${name}/LICENSE`,'utf8')}`).join('\n\n');
const js=readFileSync('public/app.js','utf8');writeFileSync('public/app.js','/*! Third-party notices\n'+notices.replaceAll('*/','* /')+'\n*/\n'+js);
copyFileSync('web/index.html','public/index.html');copyFileSync('web/style.css','public/style.css');console.log('Built self-hosted React UI with dependency license notices.');
