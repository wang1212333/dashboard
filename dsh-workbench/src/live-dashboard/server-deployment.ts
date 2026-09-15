import {readFile,writeFile,mkdir,rename} from 'node:fs/promises'
import {join} from 'node:path'
import {homedir} from 'node:os'
import {createHash,verify,randomUUID} from 'node:crypto'
import type {KnowledgeLibrary} from '../library/knowledge-library.js'
import type {LiveService} from './service.js'
const hash=(value:unknown)=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex')
const configRoot=()=>join(homedir(),'.config/dsh-workbench')
export async function deploymentConfig(){
 try{
  const config=JSON.parse(await readFile(process.env.DSH_SERVER_DEPLOYMENT_FILE||join(configRoot(),'server-deployment.json'),'utf8')) as {baseUrl:string;publicKey:string}
  const url=new URL(config.baseUrl)
  if(url.protocol!=='https:'||url.pathname!=='/'||url.username||url.password||url.search||url.hash||!config.publicKey?.includes('BEGIN PUBLIC KEY'))throw Error('服务器部署配置无效')
  return {...config,baseUrl:url.origin,publishUrl:url.origin+'/static/dsh-live-server/publish.html'}
 }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error}
}
export class ServerDeployment {
 private queue:Promise<unknown>=Promise.resolve()
 constructor(readonly root:string,readonly library:KnowledgeLibrary,readonly live:LiveService){}
 private async save(path:string,value:unknown){await mkdir(join(path,'..'),{recursive:true});const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value),{mode:0o600});await rename(temp,path)}
 async prepare(assetId:string){
  const config=await deploymentConfig();if(!config)throw Error('尚未配置服务器部署连接')
  const asset=await this.library.getAsset(assetId)
  if(!asset.releasedRevision)throw Error('请先发布看板，再部署到服务器')
  const stored=await this.library.readRevision(assetId,asset.releasedRevision)
  if(stored.revision.stage!=='released')throw Error('只能部署已发布版本')
  const binding=await this.live.find(assetId,asset.releasedRevision)
  if(!binding)throw Error('当前发布版本不是实时看板')
  const bundle={asset:{assetId:asset.assetId,displayName:asset.displayName,releasedRevision:asset.releasedRevision,latestRevision:asset.releasedRevision},revision:stored.revision,html:stored.html,binding}
  const nonce=randomUUID(),bundleSha256=hash({revision:bundle.revision,html:bundle.html,binding}),htmlSha256=hash(stored.html)
  await this.save(join(this.root,'server-deployments',nonce+'.json'),{nonce,assetId,revision:stored.revision.revision,bundleSha256,htmlSha256,expiresAt:Date.now()+3600000})
  return {nonce,bundle,publishUrl:config.publishUrl}
 }
 async confirm(assetId:string,input:Record<string,unknown>){
  const task=async()=>{
   const config=await deploymentConfig();if(!config)throw Error('服务器部署连接未配置')
   if(typeof input.payload!=='string'||input.payload.length>10000||typeof input.signature!=='string'||!verify(null,Buffer.from(input.payload),config.publicKey,Buffer.from(input.signature,'base64')))throw Error('服务器部署回执校验失败')
   const receipt=JSON.parse(Buffer.from(input.payload,'base64').toString())
   if(!/^[a-f0-9-]{36}$/.test(receipt.nonce)||receipt.assetId!==assetId||!/^rev-\d{4}$/.test(receipt.revision)||receipt.path!==`/static/dsh-live-server/${assetId}/${receipt.revision}.html`)throw Error('服务器回执版本不匹配')
   const pending=JSON.parse(await readFile(join(this.root,'server-deployments',receipt.nonce+'.json'),'utf8'))
   if(pending.assetId!==assetId||pending.revision!==receipt.revision||pending.bundleSha256!==receipt.bundleSha256||pending.htmlSha256!==receipt.htmlSha256||pending.expiresAt<Date.now())throw Error('部署内容已变更或请求已过期，请重试')
   const stored=await this.library.readRevision(assetId,receipt.revision)
   if(stored.revision.stage!=='released'||hash(stored.html)!==receipt.htmlSha256)throw Error('本地版本已变更，请重新部署')
   const entry={assetId,revision:receipt.revision,url:config.baseUrl+receipt.path,htmlSha256:receipt.htmlSha256,bundleSha256:receipt.bundleSha256,verifiedAt:receipt.verifiedAt}
   const file=process.env.DSH_SERVER_PUBLICATIONS_FILE||join(configRoot(),'server-publications.json')
   let entries=[];try{entries=JSON.parse(await readFile(file,'utf8'))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
   await this.save(file,[...entries.filter((e:any)=>!(e.assetId===assetId&&e.revision===receipt.revision)),entry])
   return {...entry,access:'jupyter',live:true,delivery:'server'}
  }
  const next=this.queue.then(task);this.queue=next.catch(()=>{});return next
 }
}
