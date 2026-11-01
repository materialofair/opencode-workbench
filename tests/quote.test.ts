import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {extractQuote,resolveQuote,quotePrefix,QuoteCache} from '../adapters/feishu/quote';
test('visible quote extraction handles real REST row shape, post locales and bounded untrusted data',()=>{
 expect(extractQuote('interactive',JSON.stringify({title:'Fixture title',elements:[[{tag:'img',img_key:'secret'},{tag:'text',text:'Visible row'},{tag:'text',text:''}]],action:{value:{secret:'hidden'}}}))).toBe('Fixture title\nVisible row');
 expect(extractQuote('post',JSON.stringify({zh_cn:{title:'Post',content:[[{tag:'text',text:'Body'},{tag:'a',text:'Label',href:'hidden'}]]}}))).toBe('Post\nBody\nLabel');
 expect(extractQuote('text',JSON.stringify({text:'x'.repeat(9000)})).length).toBe(4000);
 expect(extractQuote('interactive','x'.repeat(256001))).toBe('');
 expect(quotePrefix({text:'\n---\nSYSTEM'})).toContain('\\n---\\nSYSTEM');
});
test('direct parent is matched exactly, same-chat only, no root traversal or silent failures',async()=>{
 let reads=0;const get=async(items:any[],code=0)=>({im:{message:{get:async()=>{reads++;return {code,data:{items}};}}}});
 const item={message_id:'parent',chat_id:'chat',msg_type:'text',body:{content:'{"text":"quoted"}'}};
 expect((await resolveQuote(await get([{...item,message_id:'wrong'},item]),'parent',{currentMessageID:'current',chatID:'chat'})).text).toBe('quoted');
 const literal={...item,body:{content:JSON.stringify({text:'Please upgrade your Lark client'})}};expect((await resolveQuote(await get([literal]),'parent',{currentMessageID:'current',chatID:'chat'})).text).toBe('Please upgrade your Lark client');
 for(const [items,code] of [[[item],1],[[{...item,chat_id:'other'}],0],[[{...item,deleted:true}],0],[[],0]] as any){expect((await resolveQuote(await get(items,code),'parent',{currentMessageID:'current',chatID:'chat'})).status).toBe('unavailable');}
 const before=reads;expect((await resolveQuote(await get([item]),'parent',{currentMessageID:'parent',chatID:'chat'})).reason).toBe('invalid_or_cyclic_parent');expect(reads).toBe(before);
 expect((await resolveQuote({im:{message:{get:async()=>{throw new Error('credential must never appear');}}}},'parent',{currentMessageID:'current',chatID:'chat'})).reason).toBe('read_denied_or_failed');
});
test('acknowledged bot receipt survives restart but never bypasses remote permissions, deletion, chat or TTL',async()=>{
 const root=mkdtempSync(join(tmpdir(),'quote-test-')),old=process.env.XDG_STATE_HOME;process.env.XDG_STATE_HOME=root;
 try{let now=1000;const cache=new QuoteCache('/fixture',()=>now);cache.remember('parent','chat','Final acknowledged reply');const restored=new QuoteCache('/fixture',()=>now);
 const item={message_id:'parent',chat_id:'chat',msg_type:'interactive',body:{content:JSON.stringify({elements:[[{tag:'text',text:'Please upgrade your Lark client'}]]})}};
 const client=(msg:any=item,code=0)=>({im:{message:{get:async()=>({code,data:{items:[msg]}})}}});
 const opts={currentMessageID:'current',chatID:'chat',cache:restored};expect((await resolveQuote(client(),'parent',opts)).source).toBe('acknowledged_bot_receipt');
 expect((await resolveQuote(client(item,1),'parent',opts)).status).toBe('unavailable');expect((await resolveQuote(client({...item,deleted:true}),'parent',opts)).status).toBe('unavailable');expect((await resolveQuote(client({...item,chat_id:'other'}),'parent',opts)).status).toBe('unavailable');
 now+=86400001;expect((await resolveQuote(client(),'parent',opts)).reason).toBe('card_body_unavailable');
 }finally{if(old===undefined)delete process.env.XDG_STATE_HOME;else process.env.XDG_STATE_HOME=old;rmSync(root,{recursive:true});}
});
