const result=await Bun.build({entrypoints:['adapters/office/plugin.ts'],outdir:'adapters/office',target:'node',packages:'external',minify:false});
if(!result.success){console.error(result.logs);process.exit(1);}
console.log('Built independent office adapter; existing scheduler build is unchanged.');
export {};
