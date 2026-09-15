import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,generateKeyPairSync,sign,randomUUID} from 'node:crypto';
import {connection,fingerprint} from './runtime/mcp.js';
import {validateSpec} from './runtime/service.js';
import {viewerPage} from './viewer-page.mjs';
export const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export const validVersion=(id,rev)=>typeof id==='string'&&/^[a-z][a-z0-9-]{2,62}$/.test(id)&&typeof rev==='string'&&/^rev-\d{4}$/.test(rev);
export async function atomic(path,value){await mkdir(join(path,'..'),{recursive:true});const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,value,{mode:0o600});await rename(temp,path);}
export async function signingKey(root){
 const path=join(root,'private','publication-key.pem');
 try{return await readFile(path,'utf8')}catch(e){if(e.code!=='ENOENT')throw e;}
 const pair=generateKeyPairSync('ed25519');const key=pair.privateKey.export({type:'pkcs8',format:'pem'});
 await mkdir(join(root,'private'),{recursive:true,mode:0o700});try{await writeFile(path,key,{mode:0o600,flag:'wx'});return key}catch(e){if(e.code==='EEXIST')return readFile(path,'utf8');throw e}
}
export function publicationStore(appRoot,live,{source=connection,makePage=viewerPage}={}){
 const data=join(appRoot,'data');let queue=Promise.resolve();
 const file=(id,rev)=>join(data,'releases',id,rev+'.json');
 const read=async path=>JSON.parse(await readFile(path,'utf8'));
 async function readRevision(id,rev){
  if(!validVersion(id,rev))throw Error('看板版本无效');
  let item;try{item=await read(file(id,rev));}catch(e){if(e.code!=='ENOENT')throw e;item=await read(join(data,'releases',id+'.json'));}
  if(item.revision.revision!==rev||item.revision.stage!=='released')throw Error('发布版本不存在');
  return item;
 }
 async function publish(input){
  const run=async()=>{
   const {bundle,nonce}=input;
   if(typeof nonce!=='string'||!/^[a-f0-9-]{36}$/.test(nonce)||!bundle||typeof bundle.html!=='string'||Buffer.byteLength(bundle.html)>2000000)throw Error('部署请求无效');
   const {asset,revision,html,binding}=bundle,id=asset?.assetId,rev=revision?.revision;
   if(!validVersion(id,rev)||asset.releasedRevision!==rev||revision.stage!=='released'||binding?.assetId!==id||binding?.revision!==rev||!/^[a-f0-9-]{36}$/.test(binding?.id))throw Error('只能部署已发布的实时版本');
   if(binding.scope!==fingerprint(await source()))throw Error('服务器数据源授权与看板不匹配');
   validateSpec(binding.spec);
   const hash=digest({revision,html,binding}),htmlSha256=digest(html);
   let previous;try{previous=await read(file(id,rev));}catch(e){if(e.code!=='ENOENT')throw e;}
   if(previous&&previous.bundleSha256!==hash)throw Error('该版本已存在且内容不同，请在 DSH 发布新版本');
   const trial=await live.trial(binding.spec);
   if(!trial.validated)throw Error('服务器真实查询校验未通过');
   if(!previous){
    let oldBinding;try{oldBinding=await read(join(data,'live','binding-'+binding.id+'.json'))}catch(e){if(e.code!=='ENOENT')throw e}
    if(oldBinding&&(oldBinding.assetId!==id||oldBinding.revision!==rev||digest(oldBinding.spec)!==digest(binding.spec)))throw Error('数据绑定与已有版本冲突');
    // Never accept SQL transported by the browser; compile from validated spec.
    const safeBinding={...binding,plan:binding.plan?{...binding.plan,dialect:trial.dialect,queries:trial.queries}:undefined};
    const page=await makePage({assetId:id,revision:rev,html,bindingId:binding.id},appRoot);
    await atomic(join(data,'live','binding-'+binding.id+'.json'),JSON.stringify(safeBinding));
    await atomic(join(data,'live','asset-'+id+'-'+rev+'.json'),JSON.stringify(safeBinding));
    await atomic(join(appRoot,'public',id,rev+'.html'),page);
    await atomic(file(id,rev),JSON.stringify({asset,revision,html,bundleSha256:hash,htmlSha256,queriedAt:trial.queriedAt}));
   }
   // The version page and query always use an explicit revision, never this pointer.
   const stored=await read(file(id,rev));
   try{await read(join(data,'releases',id+'.json'))}catch(e){if(e.code!=='ENOENT')throw e;await atomic(join(data,'releases',id+'.json'),JSON.stringify(stored));}
   const receipt={nonce,assetId:id,revision:rev,bundleSha256:hash,htmlSha256,path:'/static/dsh-live-server/'+id+'/'+rev+'.html',verifiedAt:new Date().toISOString()};
   const payload=Buffer.from(JSON.stringify(receipt)).toString('base64');
   return {payload,signature:sign(null,Buffer.from(payload),await signingKey(appRoot)).toString('base64')};
  };
  const next=queue.then(run);queue=next.catch(()=>{});return next;
 }
 return {readRevision,publish};
}
