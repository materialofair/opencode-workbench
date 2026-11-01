import {test,expect} from 'bun:test';
import {prepare} from '../scripts/prepare-feishu';
test('patched dependency resolution rejects oversized inputs before expansion and preserves Effect/Feishu consumers',async()=>{
  prepare();
  const child=Bun.spawn(['node','--max-old-space-size=256','scripts/dependency-smoke.mjs'],{stdout:'pipe',stderr:'pipe'});
  const timeout=setTimeout(()=>child.kill(),8000);
  try{
    const [out,err]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text()]);
    if(await child.exited!==0)throw new Error(err||out);
    expect(JSON.parse(out)).toEqual({patchedVersions:true,collectionBoundsBeforeElements:true,integerBeforeBigInt:true,boundedTomlShapes:true,effectConsumerCompatible:true,feishuSchemasCompatible:true});
  }finally{clearTimeout(timeout);}
},10000);
