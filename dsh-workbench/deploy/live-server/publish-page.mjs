export function publishPage(transport){return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>部署实时看板</title><style>body{font:16px/1.7 system-ui;background:#fafafa;color:#292929;margin:10vh auto;max-width:640px;padding:24px}h1{font-size:24px}a{color:#245dc1}button{padding:10px 16px}</style><h1>部署实时看板</h1><p id="status">正在连接工作台…</p><p>完成服务器数据校验后，工作台会自动获得此版本的访问链接。</p><a id="result" hidden target="_blank" rel="noopener">打开服务器看板</a><script>${transport}
const status=document.getElementById('status'),openerWindow=window.opener;
let origin;try{const u=new URL(decodeURIComponent(location.hash.slice(1)));if(u.protocol!=='http:'||!['127.0.0.1','localhost'].includes(u.hostname))throw Error();origin=u.origin}catch{status.textContent='请从 DSH 分享窗口点击部署到服务器';}
let working=false;
const ready=()=>{if(openerWindow&&origin)openerWindow.postMessage({type:'dsh-publish-ready'},origin)};
const interval=setInterval(ready,1000);ready();
if(!openerWindow)status.textContent='无法连接工作台窗口，请允许弹出窗口后从 DSH 重新部署。';
addEventListener('message',async e=>{if(e.source!==openerWindow||e.origin!==origin||e.data?.type!=='dsh-publish-bundle'||working)return;working=true;clearInterval(interval);status.textContent='正在上传并核验服务器真实查询，请保持此窗口打开…';try{const receipt=await kernelQuery({operation:'publish',bundle:e.data.bundle,nonce:e.data.nonce});if(receipt.error)throw Error(receipt.error);openerWindow.postMessage({type:'dsh-publish-result',nonce:e.data.nonce,receipt},origin);status.textContent='部署完成，正在回写工作台。';}catch(error){working=false;status.textContent=error.message;openerWindow.postMessage({type:'dsh-publish-error',message:error.message},origin)}});
addEventListener('message',e=>{if(e.source!==openerWindow||e.origin!==origin||e.data?.type!=='dsh-publish-confirmed')return;status.textContent='部署成功，已回写工作台，可以分享到飞书。';const link=document.getElementById('result');link.href=e.data.url;link.hidden=false;});
</script></html>`;}
