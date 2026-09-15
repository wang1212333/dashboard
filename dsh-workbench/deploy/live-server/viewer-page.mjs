import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {inlineAssets} from './inline-assets.mjs';
import {withCurrentLiveUI} from './runtime/preview-bridge.js';
export async function viewerPage({assetId,revision,html,bindingId},root){
 if(!/<head(?:\s[^>]*)?>/i.test(html))throw Error('看板需要完整 HTML 页面');
 html=await inlineAssets(withCurrentLiveUI(html),root);
 const transport=await readFile(join(root,'kernel-transport.js'),'utf8');
 const bridge=`<script>(()=>{const pending=new Map();window.fetch=async(url,options)=>{if(url!==${JSON.stringify('/api/dsh-workbench/live/'+bindingId+'/query')})throw Error('仅允许当前看板查询');const id=String(Date.now())+Math.random();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('服务器查询超时'))},185000);pending.set(id,{resolve,reject,timer});parent.postMessage({type:'dsh-view-query',id,payload:JSON.parse(options?.body||'{}')},'*')})};addEventListener('message',e=>{if(e.source!==parent||e.data?.type!=='dsh-view-result')return;const job=pending.get(e.data.id);if(!job)return;clearTimeout(job.timer);pending.delete(e.data.id);job.resolve(new Response(JSON.stringify(e.data.result),{status:e.data.result.error?502:200}))})})();</script>`;
 const csp=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">`;
 const framed=html.replace(/<head([^>]*)>/i,m=>m+csp+bridge);
 const encoded=Buffer.from(framed).toString('base64');
 return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>实时看板</title><style>html,body{height:100%;margin:0}iframe{width:100%;height:100%;border:0;display:block}</style><iframe id="board" sandbox="allow-scripts" title="实时看板"></iframe><script>${transport}\nconst frame=document.getElementById('board');addEventListener('message',async e=>{if(e.source!==frame.contentWindow||e.data?.type!=='dsh-view-query'||typeof e.data.id!=='string')return;let result;try{result=await kernelQuery({assetId:${JSON.stringify(assetId)},revision:${JSON.stringify(revision)},payload:e.data.payload})}catch(error){result={error:error.message}}frame.contentWindow.postMessage({type:'dsh-view-result',id:e.data.id,result},'*')});frame.srcdoc=new TextDecoder().decode(Uint8Array.from(atob('${encoded}'),c=>c.charCodeAt(0)));</script></html>`;
}
