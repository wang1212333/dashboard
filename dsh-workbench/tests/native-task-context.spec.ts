import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NativeWorkbenchSessions } from '../src/native-workbench-sessions.js'
import { registerNativeTaskContext } from '../src/native-task-context.js'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

const id='session-22222222-2222-2222-2222-222222222222'
const roots:string[]=[]
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})})
async function fixture(){const root=await mkdtemp(join(tmpdir(),'workbench-context-'));roots.push(root);const links=new NativeWorkbenchSessions(root);await links.bind(id);return {root,links}}
it('keeps user speech intact and injects only source-attributed resource context',async()=>{
 const {root,links}=await fixture(), hooks=new Map<string,Function>(), tools=new Map<string,any>()
 registerNativeTaskContext({on:(name:string,fn:Function)=>hooks.set(name,fn),tools:{register:(tool:any)=>tools.set(tool.name,tool)}} as never,links,root)
 const prompt='  这个数据集中有哪些信息\n'
 await links.prepare(id,{requestId:'r1',prompt,templateId:'lieflat-r09',templateInstructions:'PRIVATE_TEMPLATE_PATH_AND_SOURCE'})
 const message=createUserMessage({content:[{type:'text',text:prompt}],source:{kind:'plugin',plugin:'fixture'}})
 // Simulate native human source, not plugin-provided input.
 const human={...message,source:{kind:'user'}}
 const result=await hooks.get('agent/pre-step')!({agent:{session:{id}},turn:1,signal:new AbortController().signal},async()=>({kind:'enter',messages:[human]}))
 expect(result.messages[0]).toBe(human)
 expect(result.messages[0].content[0].text).toBe(prompt)
 expect(result.messages[1].source).toMatchObject({kind:'plugin',plugin:'dsh-workbench'})
 expect(JSON.stringify(result.messages[1])).not.toContain('PRIVATE_TEMPLATE_PATH_AND_SOURCE')
 expect(JSON.stringify(result.messages[1])).toContain('选择模板不代表要求生成看板')
 const resources=await tools.get('workbench_get_task_context').execute({requestId:'r1'},{agent:{session:{id}}})
 expect(resources.templateInstructions).toBe('PRIVATE_TEMPLATE_PATH_AND_SOURCE')
})
it('persists distinct per-turn attachment snapshots, including identical prompts',async()=>{
 const {root,links}=await fixture()
 await links.prepare(id,{requestId:'a',prompt:'分析',uploadId:'file-a'})
 await links.claim(id,'message-a','分析',1)
 await links.prepare(id,{requestId:'b',prompt:'分析',uploadId:'file-b'})
 await links.claim(id,'message-b','分析',2)
 const restored=new NativeWorkbenchSessions(root)
 expect((await restored.inputForTurn(id,1))?.uploadId).toBe('file-a')
 expect((await restored.inputForTurn(id,2))?.uploadId).toBe('file-b')
 expect((await restored.claim(id,'message-a','分析',1))?.requestId).toBe('a')
})
it('deduplicates a prepared request and rejects changed payloads for the same id',async()=>{
 const {links}=await fixture(), input={requestId:'a',prompt:'hello'}
 await links.prepare(id,input);await links.prepare(id,input)
 expect((await links.read(id))?.inputs).toHaveLength(1)
 await expect(links.prepare(id,{...input,prompt:'changed'})).rejects.toThrow('REQUEST_ID_CONFLICT')
})
it('blocks uncertain admission and only releases an explicitly rejected pending request',async()=>{
 const {links}=await fixture()
 expect(await links.prepare(id,{requestId:'a',prompt:'first'})).toBe(true)
 expect(await links.prepare(id,{requestId:'a',prompt:'first'})).toBe(false)
 await expect(links.prepare(id,{requestId:'b',prompt:'next'})).rejects.toThrow('NATIVE_SUBMISSION_PENDING')
 await links.rejectPrepared(id,'a')
 await links.prepare(id,{requestId:'b',prompt:'next'})
 await links.claim(id,'message-b','next',1)
 await links.rejectPrepared(id,'b')
 expect((await links.inputForTurn(id,1))?.requestId).toBe('b')
})
it('does not inject into unbound native chats or consume another plugin message',async()=>{
 const {root,links}=await fixture();const hooks=new Map<string,Function>()
 registerNativeTaskContext({on:(n:string,f:Function)=>hooks.set(n,f),tools:{register:vi.fn()}} as never,links,root)
 await links.prepare(id,{requestId:'a',prompt:'hello'})
 const message=createUserMessage({content:[{type:'text',text:'hello'}],source:{kind:'plugin',plugin:'other'}})
 const result=await hooks.get('agent/pre-step')!({agent:{session:{id}},turn:1,signal:new AbortController().signal},async()=>({kind:'enter',messages:[message]}))
 expect(result.messages).toEqual([message]);expect((await links.read(id))?.inputs?.[0].messageId).toBeUndefined()
})
