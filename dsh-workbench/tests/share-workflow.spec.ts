import {expect,it,vi} from 'vitest'
import {runInNewContext} from 'node:vm'
import {dashboardSharingBehavior} from '../src/local-app/dashboard-sharing-ui.js'

// Execute the real controller, replacing only DOM rendering and registration.
function controller(fetcher:ReturnType<typeof vi.fn>){
 let source=dashboardSharingBehavior();
 source=source.slice(0,source.indexOf("document.addEventListener('dsh:share-dashboard'"));
 source=source.replace(/function render\(\)\{[\s\S]*?\nfunction search/, 'function render(){}\nfunction search');
 source+=`globalThis.driver={load,generate,send,select,validate,absorb,close,
 init(data){model={id:'test-board',title:'Board',shares:[],...data};modal={remove(){}};},
 fill(){fsSelected={id:'ou_confirmed',name:'同事'};note='附言';},
 state(){return {model,busy,selectedKey,linkError,feedback,fsError,sent,sendAttempt,note,fsSelected,preview,validation}},
};})();`;
 const sandbox:any={document:{head:{append(){}},createElement:()=>({}),body:{style:{}}},window:{scrollTo(){}},location:{pathname:'/dsh-workbench'},fetch:fetcher,AbortSignal,crypto:{randomUUID:()=> 'request-unique-123456'},setTimeout,clearTimeout,clearInterval,URL};
 runInNewContext(source,sandbox);return sandbox.driver;
}
const link={token:'token-a',url:'https://example.invalid/s/a',revision:'rev-0001',expiresAt:'2099-01-01',status:'active'};
const state=(shares:any[]=[])=>({revision:'rev-0001',shares,live:true});
const reply=(v:unknown,status=200)=>Response.json(v,{status});
it('opening reuses a single matching link without create or send; ambiguous choices are not auto-selected',async()=>{
 const f=vi.fn(async(url:string)=>reply(url.endsWith('shares')?state([link]):{configured:true}));const c=controller(f);c.init({});await c.load();expect(c.state().selectedKey).toBe('token-a');expect(f.mock.calls).toHaveLength(2);
 const d=controller(f);d.init(state([link,{...link,token:'b',url:'https://example.invalid/s/b'}]));d.absorb(state([link,{...link,token:'b',url:'https://example.invalid/s/b'}]));expect(d.state().selectedKey).toBe('');
});
it('list failure is not an empty state and cannot create links',async()=>{
 const f=vi.fn(async()=>reply({error:'offline'},503));const c=controller(f);c.init({});await c.load();await c.generate();expect(c.state().model.failed).toBe(true);expect(f).toHaveBeenCalledTimes(1);
});
it('generation is single-flight, updates link only, and never sends or copies',async()=>{
 let finish:(r:Response)=>void=()=>{};const f=vi.fn(()=>new Promise<Response>(resolve=>finish=resolve));const c=controller(f);c.init(state());const task=c.generate();await c.generate();expect(f).toHaveBeenCalledTimes(1);finish(reply(link));await task;expect(c.state().selectedKey).toBe('token-a');expect(c.state().sent).toBe(null);
});
it('generation failure reconciles with the existing list before allowing retry',async()=>{
 const f=vi.fn().mockResolvedValueOnce(reply({error:'temporary'},503)).mockResolvedValueOnce(reply(state())).mockResolvedValueOnce(reply(link));const c=controller(f);c.init(state());await c.generate();expect(c.state().feedback).toBe('temporary');await c.generate();expect(c.state().selectedKey).toBe('token-a');expect(f).toHaveBeenCalledTimes(3);
});
it('cannot send without a confirmed recipient or usable link',async()=>{
 const f=vi.fn();const c=controller(f);c.init(state());await c.send({preventDefault(){}});c.fill();await c.send({preventDefault(){}});expect(f).not.toHaveBeenCalled();
});
it('failed send preserves snapshot, retries same id, and does not create a link',async()=>{
 let sends=0;const f=vi.fn(async(url:string,options:any)=>{if(url.endsWith('shares'))return reply(state([link]));const data=JSON.parse(options.body);return data.action==='preview'?reply({card:{}}):++sends===1?reply({error:'transport unavailable'},503):reply({messageId:'ok'});});
 const c=controller(f);c.init(state([link]));c.absorb(state([link]));c.fill();await c.send({preventDefault(){}});expect(c.state().sent).toBe(null);expect(c.state().note).toBe('附言');expect(c.state().fsSelected.id).toBe('ou_confirmed');await c.send({preventDefault(){}});expect(c.state().sent.name).toBe('同事');
 const attempts=f.mock.calls.filter(([,o])=>o.body&&JSON.parse(o.body).action==='send').map(([,o])=>JSON.parse(o.body));expect(attempts[0]).toEqual(attempts[1]);expect(f.mock.calls.filter(([url,o])=>url.endsWith('shares')&&o.method!=='GET')).toHaveLength(0);
});
it('invalidated link blocks sending and retains recipient/note',async()=>{
 const f=vi.fn(async()=>reply(state([{...link,status:'revoked'}])));const c=controller(f);c.init(state([link]));c.absorb(state([link]));c.fill();await c.send({preventDefault(){}});expect(f).toHaveBeenCalledTimes(1);expect(c.state().linkError).toContain('失效');expect(c.state().note).toBe('附言');expect(c.state().fsSelected.id).toBe('ou_confirmed');
});
it('late preview cannot replace a newer selected link',async()=>{
 let finish:(r:Response)=>void=()=>{};const second={...link,token:'b',url:'https://example.invalid/s/b'};const f=vi.fn(()=>new Promise<Response>(r=>finish=r));const c=controller(f);c.init(state([link,second]));c.select(link);const task=c.validate(true);c.select(second);finish(reply(state([link,second])));await task;expect(c.state().selectedKey).toBe('b');expect(c.state().preview).toBe(null);expect(c.state().validation).toBe('');
});
it('a failed preflight during retry never discards an uncertain send id',async()=>{
 let reads=0;const f=vi.fn(async(url:string,options:any)=>{if(url.endsWith('shares'))return ++reads===2?reply({error:'offline'},503):reply(state([link]));return JSON.parse(options.body).action==='preview'?reply({card:{}}):reply({error:'result unknown'},503)});
 const c=controller(f);c.init(state([link]));c.absorb(state([link]));c.fill();await c.send({preventDefault(){}});const original=c.state().sendAttempt.requestId;await c.send({preventDefault(){}});expect(c.state().sendAttempt.requestId).toBe(original);
});
