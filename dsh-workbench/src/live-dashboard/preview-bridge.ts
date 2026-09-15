import { sqlInspector } from './inspector.js'
import { filterControls } from './filter-controls.js'
/** Keep generated code in an opaque-origin sandbox. Only its own revision may be queried. */
export function embeddedQueryHost(): string {
 return String.raw`(()=>{const pending=new WeakMap();addEventListener('message',async event=>{
 if(event.data?.kind!=='dsh-live-preview-query'||event.origin!=='null'||!event.ports[0])return;
 const frame=Array.from(document.querySelectorAll('iframe.dashboard-viewer-frame,iframe.dashboard-preview-frame')).find(f=>f.contentWindow===event.source);
 if(!frame)return;const port=event.ports[0];
 const url=new URL(frame.src,location.href),match=/^\/dsh-workbench\/assets\/([a-z][a-z0-9-]{2,62})\/(rev-\d{4})\/dashboard\.html$/.exec(url.pathname);
 if(url.origin!==location.origin||!match||(pending.get(frame)||0)>=4){port.postMessage({status:403,data:{error:'预览查询不可用'}});port.close();return}
 pending.set(frame,(pending.get(frame)||0)+1);try{
 const api=location.pathname.startsWith('/dsh-workbench')?'/api/dsh-workbench':'/api';
 if(event.data.filters!==null && event.data.filters!==undefined && (typeof event.data.filters!=='string'||event.data.filters.length>4096))throw Error('筛选参数无效');
 const suffix=event.data.filters==null?'':'?filters='+encodeURIComponent(event.data.filters);
 if(event.data.body!==undefined&&(typeof event.data.body!=='string'||event.data.body.length>64000))throw Error('查询参数无效');
 const response=await fetch(api+'/live-preview/'+match[1]+'/'+match[2]+suffix,{...(event.data.body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:event.data.body}),cache:'no-store',signal:AbortSignal.timeout(180000)});
 const data=await response.json();if(frame.contentWindow===event.source)port.postMessage({status:response.status,data});
 }catch{port.postMessage({status:503,data:{error:'实时查询暂不可用，请稍后刷新'}})}finally{pending.set(frame,Math.max(0,(pending.get(frame)||1)-1));port.close()}
})})()`
}

export function withCurrentLiveUI(html: string): string {
 // Upgrade only our known filter block, never generated chart code or routing.
 html=html.replace(/(<script\b[^>]*data-dsh-live-runtime[^>]*>)([\s\S]*?)(<\/script\s*>)/gi,(_all,start,body,end)=>start+body.replace(/ let appliedFilters,filterForm,applyButton,optionLoads=0;[\s\S]*?(?= async function refresh\(\))/,(block:string)=>block.includes('function setupFilters(data)')?filterControls():block)+end)
 // Refresh the runtime UI of existing revisions without altering stored charts or queries.
 html=html.replace(/<script\b[^>]*data-dsh-sql-inspector[^>]*>[\s\S]*?<\/script\s*>/gi,()=>sqlInspector())
 return html
}
export function withEmbeddedQueryBridge(html: string, bindingId: string): string {
 html=withCurrentLiveUI(html)
 const endpoint=JSON.stringify('/api/dsh-workbench/live/'+bindingId+'/query')
 const script=`<script data-dsh-preview-bridge>(()=>{
 if(parent===window||self.origin!=='null')return;
 const original=window.fetch.bind(window);window.fetch=(input,options)=>{
 const url=new URL(typeof input==='string'?input:input.url||String(input),location.href);
 if(url.origin!==location.origin||url.pathname!==${endpoint}||!['GET','POST'].includes(options?.method||'GET'))return original(input,options);
 return new Promise((resolve,reject)=>{
 const channel=new MessageChannel();let timer;
 const done=()=>{clearTimeout(timer);channel.port1.close();options?.signal?.removeEventListener('abort',abort)};
 const abort=()=>{done();reject(new Error('查询已取消'))};
 if(options?.signal?.aborted)return abort();options?.signal?.addEventListener('abort',abort,{once:true});
 channel.port1.onmessage=event=>{done();resolve(new Response(JSON.stringify(event.data.data),{status:event.data.status,headers:{'content-type':'application/json'}}))};
 timer=setTimeout(()=>{done();reject(new Error('工作台查询响应超时'))},180000);
 parent.postMessage({kind:'dsh-live-preview-query',filters:url.searchParams.get('filters'),body:options?.method==='POST'?options.body:undefined},location.origin,[channel.port2]);
 });};})();</script>`
 return html.replace(/<head\b[^>]*>/i,match=>match+script)
}
