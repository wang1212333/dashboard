import {test,expect,vi,afterEach} from 'vitest'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {serverPublication} from '../src/live-dashboard/server-publications.js'
import {dashboardFeishu} from '../src/local-app/dashboard-sharing.js'
import {dashboardSharingBehavior} from '../src/local-app/dashboard-sharing-ui.js'
import {Script} from 'node:vm'
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals()})
const asset={assetId:'sample-board',displayName:'实时看板',releasedRevision:'rev-0001',latestRevision:'rev-0001'}
const library:any={getAsset:async()=>asset,readRevision:async()=>({html:'<html>release</html>',revision:{revision:'rev-0001',stage:'released'}})}
test('server publication is matched to the exact released HTML and revision',async()=>{
 const root=await mkdtemp(join(tmpdir(),'publication-'));
 try {
  const path=join(root,'publications.json');vi.stubEnv('DSH_SERVER_PUBLICATIONS_FILE',path)
  const entry={assetId:asset.assetId,revision:'rev-0001',url:'https://example.com/static/dsh-live-server/sample-board.html',htmlSha256:createHash('sha256').update('<html>release</html>').digest('hex'),verifiedAt:'2026-09-14'}
  await writeFile(path,JSON.stringify([entry]));expect((await serverPublication(library,asset.assetId))?.access).toBe('jupyter')
  await writeFile(path,JSON.stringify([{...entry,htmlSha256:'wrong'}]));expect(await serverPublication(library,asset.assetId)).toBeUndefined()
  await writeFile(path,JSON.stringify([{...entry,url:'https://example.com/other'}]));await expect(serverPublication(library,asset.assetId)).rejects.toThrow('地址无效')
 }finally{await rm(root,{recursive:true,force:true})}
})
test('live send validates ownership, expiry/revocation, host and current version before calling transport',async()=>{
 vi.stubEnv('DSH_LIVE_SHARE_URL','http://10.1.2.3:4340');vi.stubEnv('DSH_ONLINE_URL','http://127.0.0.1:18087');vi.stubEnv('DSH_ONLINE_ADMIN_TOKEN','test')
 const fetcher=vi.fn(async()=>Response.json({preview:true}));vi.stubGlobal('fetch',fetcher)
 const share={assetId:'sample-board',id:'manager-id',revision:'rev-0001',expiresAt:'2099-01-01'}
 const live:any={find:async()=>({id:'binding'}),authorize:vi.fn(async()=>share)}
 const input={action:'preview',url:'http://10.1.2.3:4340/s/'+'a'.repeat(48),token:'manager-id'}
 await dashboardFeishu('sample-board','POST',input,{library,live})
 expect(fetcher).toHaveBeenCalledTimes(1)
 const sent=JSON.parse((fetcher.mock.calls[0] as any)[1].body);expect(sent.access).toBe('lan');expect(sent.preview).toBe(true)
 await expect(dashboardFeishu('sample-board','POST',{...input,token:'another'},{library,live})).rejects.toThrow('不属于')
 await expect(dashboardFeishu('sample-board','POST',{...input,url:'http://10.1.2.4:4340/s/'+'a'.repeat(48)},{library,live})).rejects.toThrow('不匹配')
 live.authorize.mockRejectedValueOnce(Error('revoked'));await expect(dashboardFeishu('sample-board','POST',input,{library,live})).rejects.toThrow('revoked')
 expect(fetcher).toHaveBeenCalledTimes(1)
})
test('sharing UI compiles and exposes server and live delivery without mislabeling snapshots',()=>{
 const source=dashboardSharingBehavior();new Script(source)
 expect(source).not.toContain('model.failed||model.live)return')
 expect(source).toContain('model.serverPublication?[model.serverPublication]')
 expect(source).toContain('delivery:s.delivery')
 expect(source).toContain('具备 Jupyter 登录权限')
})
