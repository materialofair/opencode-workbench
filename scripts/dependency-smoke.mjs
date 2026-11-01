import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {tool} from '@opencode-ai/plugin';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Path from 'effect/Path';
import * as Primitive from 'effect/unstable/cli/Primitive';

const pluginRequire=createRequire(import.meta.resolve('@opencode-ai/plugin'));
const effectRequire=createRequire(pluginRequire.resolve('effect'));
assert.equal(pluginRequire('zod/package.json').version,'4.6.7');
assert.equal(effectRequire('toml/package.json').version,'5.0.1');
const z=tool.schema,toml=effectRequire('toml');
for(const kind of ['array','set','map']){
  let visited=0;const item=z.string().superRefine(()=>{visited++;});
  const schema=kind==='array'?z.array(item).max(2):kind==='set'?z.set(item).max(2):z.map(item,item).max(2);
  const values=Array.from({length:1000},(_,i)=>`fixture-${i}`);
  const input=kind==='array'?values:kind==='set'?new Set(values):new Map(values.map(v=>[v,v]));
  const result=schema.safeParse(input);
  assert.equal(result.success,false);assert.equal(visited,0);assert.equal(result.error.issues.length,1);
}
assert.deepEqual(z.array(z.string()).max(2).parse(['valid']),['valid']);
const nativeBigInt=globalThis.BigInt;let conversions=0;
try{
  globalThis.BigInt=(...args)=>{conversions++;return nativeBigInt(...args);};
  assert.throws(()=>toml.parse('value = 0x'+'f'.repeat(100000)));
  assert.equal(conversions,0,'oversized integer must be rejected before BigInt conversion');
}finally{globalThis.BigInt=nativeBigInt;}
const tables=Array.from({length:1000},(_,i)=>`[[fixture_${i}]]\nvalue = ${i}`).join('\n');
assert.equal(Object.keys(toml.parse(tables)).length,1000);
const dotted=Array.from({length:1000},(_,i)=>`part_${i}`).join('.')+' = 1';
let cursor=toml.parse(dotted);for(let i=0;i<1000;i++)cursor=cursor[`part_${i}`];assert.equal(cursor,1);
assert.throws(()=>toml.parse('value = 9007199254740992')); // v5 deliberately rejects lossy numbers.

// Exercise the actual Effect CLI consumer with in-memory services; no file or
// network access and no gateway. Workbench itself does not import this module.
const decoded=await Effect.runPromise(Primitive.fileParse({format:'toml'}).parse('/fixture/config.toml').pipe(
  Effect.provideService(FileSystem.FileSystem,{exists:()=>Effect.succeed(true),stat:()=>Effect.succeed({type:'File'}),readFileString:()=>Effect.succeed('name = "fixture"\ncount = 42\nenabled = true')}),
  Effect.provideService(Path.Path,path.posix)
));
assert.deepEqual(JSON.parse(JSON.stringify(decoded)),{name:'fixture',count:42,enabled:true});

// Validate preserved upstream card schemas with the exact patched tool.schema.
const code=readFileSync(new URL('../.data/feishu/dist/index.desktop.js',import.meta.url),'utf8');
const context=vm.createContext({tool});
vm.runInContext(code.slice(code.indexOf('var z2 = tool.schema;'),code.indexOf('function createSendCardTool(')),context);
assert.equal(context.SelectFieldSchema.safeParse({type:'select',name:'choice',inlineLabel:'Choice',options:[{label:'Valid',value:'valid'}]}).success,true);
const rejected=context.SelectFieldSchema.safeParse({type:'select',name:'choice',inlineLabel:'Choice',options:Array(1000).fill(null)});
assert.equal(rejected.success,false);assert.equal(rejected.error.issues.length,1);
console.log(JSON.stringify({patchedVersions:true,collectionBoundsBeforeElements:true,integerBeforeBigInt:true,boundedTomlShapes:true,effectConsumerCompatible:true,feishuSchemasCompatible:true}));
