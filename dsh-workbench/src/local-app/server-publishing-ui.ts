export function serverPublishingBehavior(){return String.raw`
window.dshDeployReleased=async function({assetId,publishUrl,popup,prepared}){
 let remoteOrigin=new URL(publishUrl).origin,ready=false,finished=false;
 let resolveResult,rejectResult;
 const completion=new Promise((resolve,reject)=>{resolveResult=resolve;rejectResult=reject});
 completion.catch(()=>{});
 const send=()=>{if(ready&&prepared)popup.postMessage({type:'dsh-publish-bundle',bundle:prepared.bundle,nonce:prepared.nonce},remoteOrigin)};
 const receive=event=>{if(event.source!==popup||event.origin!==remoteOrigin)return;const value=event.data;if(value?.type==='dsh-publish-ready'){ready=true;send()}else if(value?.type==='dsh-publish-result'&&value.nonce===prepared?.nonce)resolveResult(value.receipt);else if(value?.type==='dsh-publish-error')rejectResult(Error(value.message||'服务器部署失败'))};
 addEventListener('message',receive);
 if(!popup){removeEventListener('message',receive);throw Error('请允许弹出窗口后重试发布')}
 popup.location.assign(publishUrl+'#'+encodeURIComponent(location.origin));
 const timeout=setTimeout(()=>rejectResult(Error('部署等待超时；可重试，不会重复覆盖版本')),300000);
 const closed=setInterval(()=>{if(popup.closed&&!finished)rejectResult(Error('部署窗口已关闭，请重试'))},1000);
 try{
  const endpoint=api(assetId).replace(/shares$/,'server-publication');
  if(!prepared){const prepare=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'prepare'})});prepared=await prepare.json();if(!prepare.ok)throw Error(prepared.error||'无法准备发布版本')}send();
  const receipt=await completion;
  const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'confirm',...receipt})});const publication=await response.json();if(!response.ok)throw Error(publication.error||'部署回执校验失败');
  popup.postMessage({type:'dsh-publish-confirmed',url:publication.url},remoteOrigin);return publication;
 }finally{finished=true;clearTimeout(timeout);clearInterval(closed);removeEventListener('message',receive)}
};
async function deployServer(){
 if(busy)return;
 const popup=window.open('about:blank','dsh-server-publish','width=860,height=650');
 busy=true;feedback='正在发布到服务器，请在弹出窗口完成登录（如需要）…';render();
 try{model.serverPublication=await window.dshDeployReleased({assetId:model.id,publishUrl:model.serverDeployUrl,popup});feedback='已发布到服务器，现在可分享到飞书'}catch(error){feedback=error.message}finally{busy=false;render()}
}
`}
