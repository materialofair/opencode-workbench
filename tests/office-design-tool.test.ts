import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OfficeArtifacts} from '../adapters/office/plugin';

test('design reference tool returns pinned local provenance without project writes or visual claims',async()=>{
 const root=mkdtempSync(join(tmpdir(),'office-design-tool-'));
 try{
  const plugin=await OfficeArtifacts({directory:root} as any);
  const response=JSON.parse(await plugin.tool!.office_design_reference.execute({query:'comparison categories bar chart',domain:'chart',limit:3},{abort:new AbortController().signal} as any) as string);
  expect(response.ok).toBe(true);expect(response.result.source.commit).toBe('6ae86f61f520d6ca229d2f40e070410638c908c5');
  expect(response.result.count).toBeGreaterThan(0);expect(response.result.visual_review).toBe('pending-human-review');
  expect(response.result.font_stack).toContain('PingFang SC');expect(readdirSync(root)).toEqual([]);
  const capabilities=JSON.parse(await plugin.tool!.office_capabilities.execute({topic:'design'} as any,{} as any) as string);
  expect(capabilities.design.tool).toBe('office_design_reference');
 }finally{rmSync(root,{recursive:true,force:true});}
},10000);
