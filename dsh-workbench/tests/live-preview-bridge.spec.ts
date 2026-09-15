import { expect, it, vi } from 'vitest'
import { runInNewContext } from 'node:vm'
import { embeddedQueryHost } from '../src/live-dashboard/preview-bridge.js'

it('binds embedded requests to the actual iframe revision, ignoring supplied URLs',async()=>{
 let handler:any
 const child={},frame={contentWindow:child,src:'http://localhost/dsh-workbench/assets/test-board/rev-0002/dashboard.html'}
 const fetch=vi.fn(async()=>({status:200,json:async()=>({validated:true})})),postMessage=vi.fn()
 runInNewContext(embeddedQueryHost(),{addEventListener:(_name:string,fn:any)=>handler=fn,document:{querySelectorAll:()=>[frame]},location:{href:'http://localhost/dsh-workbench',pathname:'/dsh-workbench',origin:'http://localhost'},URL,WeakSet,AbortSignal,fetch})
 await handler({origin:'null',source:child,data:{kind:'dsh-live-preview-query',url:'/api/admin',asset:'someone-else'},ports:[{postMessage,close:vi.fn()}]})
 expect(fetch.mock.calls[0]?.[0]).toBe('/api/dsh-workbench/live-preview/test-board/rev-0002')
 expect(postMessage).toHaveBeenCalledWith({status:200,data:{validated:true}})
 fetch.mockClear()
 await handler({origin:'null',source:child,data:{kind:'dsh-live-preview-query',filters:'{"country":"A"}'},ports:[{postMessage,close:vi.fn()}]})
 expect(fetch.mock.calls[0]?.[0]).toBe('/api/dsh-workbench/live-preview/test-board/rev-0002?filters=%7B%22country%22%3A%22A%22%7D')
 fetch.mockClear()
 await handler({origin:'null',source:child,data:{kind:'dsh-live-preview-query',body:JSON.stringify({filters:{country:['A','B']},option:'country'})},ports:[{postMessage,close:vi.fn()}]})
 expect(fetch.mock.calls[0]?.[1].method).toBe('POST')
 expect(JSON.parse(fetch.mock.calls[0]?.[1].body).option).toBe('country')
 fetch.mockClear()
 await handler({origin:'null',source:{},data:{kind:'dsh-live-preview-query'},ports:[{postMessage,close:vi.fn()}]})
 expect(fetch).not.toHaveBeenCalled()
})
