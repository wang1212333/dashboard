import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { KnowledgeLibrary } from '../library/knowledge-library.js'

export async function serverPublication(library: KnowledgeLibrary, assetId: string) {
  let entries: Array<{assetId:string;revision:string;url:string;htmlSha256:string;verifiedAt:string}>
  try { entries=JSON.parse(await readFile(process.env.DSH_SERVER_PUBLICATIONS_FILE || join(homedir(),'.config/dsh-workbench/server-publications.json'),'utf8')) }
  catch(error) { if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error }
  const asset=await library.getAsset(assetId)
  const entry=entries.find(e=>e.assetId===assetId&&e.revision===asset.releasedRevision)
  if(!entry)return undefined
  const url=new URL(entry.url)
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!['/static/dsh-live-server/'+assetId+'.html','/static/dsh-live-server/'+assetId+'/'+entry.revision+'.html'].includes(url.pathname))throw Error('服务器发布登记地址无效')
  const stored=await library.readRevision(assetId,entry.revision)
  if(stored.revision.stage!=='released'||createHash('sha256').update(stored.html).digest('hex')!==entry.htmlSha256)return undefined
  return {url:entry.url,revision:entry.revision,access:'jupyter' as const,verifiedAt:entry.verifiedAt,live:true,delivery:'server' as const}
}
