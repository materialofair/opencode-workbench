import {test,expect} from 'bun:test';
import {toolTranscript,assertDiscoveredSkills,checkedOfficeResult,checkedCapabilitiesResult,checkedValidationResult,ordinaryTask} from '../scripts/integration-office';

test('integration fixture follows actual tool return identities, not just tool counts',()=>{
 const messages=[{role:'assistant',tool_calls:[{id:'load-1',function:{name:'skill',arguments:'{"name":"office-artifacts"}'}}]},{role:'tool',tool_call_id:'load-1',content:[{type:'text',text:'内网办公产物工作流'}]}];
 expect(toolTranscript(messages)).toEqual([{name:'skill',args:{name:'office-artifacts'},text:'内网办公产物工作流'}]);
 expect(()=>toolTranscript([{role:'tool',tool_call_id:'unknown',content:'fake'}])).toThrow('no preceding call');
});
test('skill discovery requires both actual descriptions and exposed name parameter',()=>{
 const skills=[{name:'office-artifacts',description:'Data workflow'},{name:'office-visual-composition',description:'Visual workflow'}];
 const definitions=[{function:{name:'skill',description:'office-artifacts: Data workflow; office-visual-composition: Visual workflow',parameters:{properties:{name:{type:'string'}}}}}];
 expect(assertDiscoveredSkills(definitions,skills).descriptions_visible).toHaveLength(2);
 const generic=[{function:{...definitions[0].function,description:'Load skill from system prompt'}}];expect(assertDiscoveredSkills(generic,skills,[{role:'system',content:definitions[0].function.description}]).catalog_in_system_messages).toBe(true);
 expect(()=>assertDiscoveredSkills([],skills)).toThrow('lacks built-in');
 expect(()=>assertDiscoveredSkills([{function:{...definitions[0].function,description:'office-artifacts; office-visual-composition'}}],skills)).toThrow('description not visible');
});
test('office return validator rejects unsuccessful or missing results',()=>{
 expect(checkedOfficeResult('{"ok":true,"result":{"source_sha256":"actual"}}').source_sha256).toBe('actual');
 expect(()=>checkedOfficeResult('{"ok":false,"error":"denied"}')).toThrow('successful');
 expect(()=>checkedOfficeResult('{"ok":true}')).toThrow('successful');
});
test('ordinary task is Chinese outcome language without tool or skill names',()=>{
 const task=ordinaryTask(true,true);expect(task).toContain('source.xlsx');expect(task).toContain('搜索、排序');expect(task).not.toContain('office_');expect(task).not.toContain('skill');expect(task).not.toContain('fixture');
});

test('capabilities must supply the actual singular example and validation uses its real report envelope',()=>{
 const base={protocol_version:1,html:{},design:{}};expect(()=>checkedCapabilitiesResult(JSON.stringify({...base,examples:{dashboard:{version:1,sections:[]}}}))).toThrow('returned example');expect(checkedCapabilitiesResult(JSON.stringify({...base,example:{version:1,sections:[]}})).example.version).toBe(1);
 expect(checkedValidationResult('{"ok":true,"status":"passed","report":{"passed":true,"status":"passed"}}').report.passed).toBe(true);expect(()=>checkedValidationResult('{"ok":true,"passed":true}')).toThrow('did not pass');
});
