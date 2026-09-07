import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import type { KnowledgeLibrary } from '../library/knowledge-library.js'

const deployment = fileURLToPath(new URL('../../deploy/online/', import.meta.url))
interface SharedLink { token: string; revision: string; url: string; expiresAt: string; status: string }
async function connection() {
  if (process.env.DSH_ONLINE_URL && process.env.DSH_ONLINE_ADMIN_TOKEN) return {url:process.env.DSH_ONLINE_URL,token:process.env.DSH_ONLINE_ADMIN_TOKEN,lan:false}
  // Explicitly generated local LAN configuration, never exposed to the browser.
  let text: string
  try { text = await readFile(resolve(deployment,'.env.lan'),'utf8') } catch { throw new Error('PUBLISH_NOT_CONFIGURED:尚未配置分享服务') }
  const env = Object.fromEntries(text.split(/\r?\n/).filter(line=>line.includes('=')).map(line=>[line.slice(0,line.indexOf('=')),line.slice(line.indexOf('=')+1)]))
  if (env.ALLOW_LAN_HTTP !== 'true' || !/^\d+$/.test(env.PORT || '') || !env.ADMIN_TOKEN) throw new Error('PUBLISH_CONFIG_INVALID')
  return {url:`http://127.0.0.1:${env.PORT}`,token:env.ADMIN_TOKEN,lan:true}
}
async function request(path:string, method='GET', data?:unknown) {
  const config = await connection(), url = new URL(config.url)
  if (url.search || url.hash || url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1','localhost'].includes(url.hostname)))) throw new Error('PUBLISH_CONFIG_INVALID')
  let response: Response
  try { response=await fetch(config.url.replace(/\/$/,'')+path,{method,redirect:'error',headers:{authorization:`Bearer ${config.token}`,'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(30000)}) } catch { throw new Error('PUBLISH_UNAVAILABLE:分享服务未启动或无法连接，请稍后重试') }
  const result = await response.json() as {shares:SharedLink[];error?:string} & SharedLink
  if (!response.ok) throw new Error('PUBLISH_FAILED:'+(result.error || response.status))
  return result
}
async function current(library:KnowledgeLibrary,id:string) {
  const asset = await library.getAsset(id)
  return library.readRevision(id,asset.releasedRevision || asset.latestRevision)
}
export async function dashboardShareState(library:KnowledgeLibrary,id:string) {
  const stored = await current(library,id), config=await connection()
  const result=await request('/api/shares?assetId='+encodeURIComponent(id))
  return {title:stored.manifest.displayName,revision:stored.revision.revision,isDraft:stored.revision.stage==='draft',lan:config.lan,shares:result.shares}
}
async function portableHtml(html:string) {
  const url='https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js'
  const marker=`<script src="${url}"></script>`
  if (!html.includes(marker)) return html
  const cache=resolve(deployment,'data-lan','echarts-5.4.3.js')
  let script:string
  try { script=await readFile(cache,'utf8') } catch {
    const response=await fetch(url,{signal:AbortSignal.timeout(30000)})
    if (!response.ok) throw new Error('PUBLISH_CHART_FAILED:图表资源打包失败，请重试')
    script=await response.text(); await mkdir(resolve(deployment,'data-lan'),{recursive:true}); await writeFile(cache,script)
  }
  return html.replace(marker,()=>'<script>'+script.replace(/<\/script/gi,'<\\/script')+'</script>')
}
export async function createDashboardShare(library:KnowledgeLibrary,id:string,days:unknown) {
  if (![1,7,30].includes(days as number)) throw new Error('PUBLISH_DAYS_INVALID:请选择 1、7 或 30 天')
  const stored=await current(library,id)
  // A share is an immutable viewing snapshot; it does not change the source lifecycle.
  await request('/api/releases','POST',{assetId:id,revision:stored.revision.revision,title:stored.manifest.displayName,html:await portableHtml(stored.html)})
  return request('/api/shares','POST',{assetId:id,revision:stored.revision.revision,days,reuse:true})
}
export async function revokeDashboardShare(id:string,token:unknown) {
  if (typeof token!=='string'|| !/^[a-f0-9]{48}$/.test(token)) throw new Error('PUBLISH_TOKEN_INVALID')
  const {shares}=await request('/api/shares?assetId='+encodeURIComponent(id))
  if (!shares.some(s=>s.token===token)) throw new Error('PUBLISH_SHARE_NOT_FOUND')
  return request('/api/shares/'+token,'DELETE')
}

export async function dashboardFeishu(id:string,method:string,input:Record<string,unknown>) {
  if(method==='GET') return request('/api/feishu/config')
  if(input.action==='search') return request('/api/feishu/users?q='+encodeURIComponent(String(input.query||'')))
  if(input.action==='configure') return request('/api/feishu/config','POST',{appId:input.appId,appSecret:input.appSecret})
  if(input.action!=='send') throw new Error('PUBLISH_INVALID:操作无效')
  const {shares}=await request('/api/shares?assetId='+encodeURIComponent(id))
  if(!shares.some(s=>s.token===input.token&&s.status==='active')) throw new Error('PUBLISH_INVALID:链接不存在或已失效')
  return request('/api/feishu/send','POST',{token:input.token,receiveIdType:input.userId?'open_id':'email',receiveId:input.userId||input.email,requestId:input.requestId,note:input.note})
}
