import { readLiveRequest } from './request.js'
import { createServer, type Server } from 'node:http'
import { networkInterfaces } from 'node:os'
import type { LiveService } from './service.js'

export const sharePort = () => Number(process.env.DSH_LIVE_SHARE_PORT || 4340)
export function shareBase() {
 if(process.env.DSH_LIVE_SHARE_URL)return process.env.DSH_LIVE_SHARE_URL.replace(/\/$/,'')
 const addresses=Object.values(networkInterfaces()).flat().filter(a=>a?.family==='IPv4'&&!a.internal&&!a.address.startsWith('169.254.'))
 return 'http://'+(addresses[0]?.address||'127.0.0.1')+':'+sharePort()
}
export function startLiveShareServer(live: LiveService): Server {
 const server=createServer(async(req,res)=>{
  res.setHeader('cache-control','no-store');res.setHeader('referrer-policy','no-referrer');res.setHeader('x-content-type-options','nosniff');res.setHeader('content-security-policy',"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
  const send=(status:number,value:unknown)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(value))}
  try {
   if(!['GET','POST'].includes(req.method||''))return send(405,{error:'只读访问'})
   const path=new URL(req.url||'/','http://localhost').pathname,match=/^\/s\/([a-f0-9]{48})(\/query)?$/.exec(path)
   if(!match||req.method==='POST'&&!match[2])return send(404,{error:'需要有效的实时分享链接'})
   const share=await live.authorize(match[1])
   if(match[2]){const result=await live.request(share.binding,await readLiveRequest(req,new URL(req.url||'/', 'http://localhost')));await live.authorize(match[1]);const {sqlProvenance,...publicResult}=result as typeof result & {sqlProvenance?:unknown};return send(200,publicResult)}
   const asset=await live.library.readRevision(share.assetId,share.revision)
   res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(asset.html.includes('data-dsh-live-runtime') ? asset.html : asset.html.replaceAll('/api/dsh-workbench/live/'+share.binding+'/query','/s/'+match[1]+'/query'))
  }catch {send(403,{error:'链接无效、已撤销、授权变更或数据源暂时不可用，请联系分享人'})}
 })
 server.on('error',()=>console.error('实时分享服务启动失败，请检查 DSH_LIVE_SHARE_PORT 是否被占用'))
 server.listen(sharePort(),process.env.DSH_LIVE_SHARE_HOST||'0.0.0.0')
 return server
}
