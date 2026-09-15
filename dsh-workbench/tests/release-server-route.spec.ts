import {it,expect,vi} from 'vitest'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createServer} from 'node:http'
import {makeWorkbenchWebRoutes} from '../src/web-ui/host-routes.js'

it('rejects missing server configuration before release and returns a retryable pinned deployment',async()=>{
 const root=await mkdtemp(join(tmpdir(),'release-server-'));vi.stubEnv('DSH_SERVER_DEPLOYMENT_FILE',join(root,'config.json'));
 const asset:any={assetId:'sample-board',latestRevision:'rev-0001',displayName:'Sample'};
 const revision:any={revision:'rev-0001',stage:'preview'};
 const release=vi.fn(async()=>{revision.stage='released';asset.releasedRevision='rev-0001';return {assetId:asset.assetId,revision:revision.revision}});
 const library:any={getAsset:async()=>asset,readRevision:async()=>({asset,revision,html:'<html><head></head></html>'}),release};
 const live:any={find:async()=>({id:'binding',assetId:asset.assetId,revision:'rev-0001',spec:{}})};
 const route=makeWorkbenchWebRoutes(library,undefined,root,undefined,undefined,live).find(r=>r.path==='/api/dsh-workbench')!;
 const server=createServer((req,res)=>void route.handler(req,res));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+(server.address() as any).port;
 const send=async()=>fetch(origin+'/api/dsh-workbench/dashboard-drafts/sample-board/rev-0001/release',{method:'POST',headers:{origin,'content-type':'application/json'},body:'{"confirmed":true}'});
 try{
  expect((await send()).ok).toBe(false);expect(release).not.toHaveBeenCalled();
  await writeFile(join(root,'config.json'),JSON.stringify({baseUrl:'https://example.com',publicKey:'-----BEGIN PUBLIC KEY-----'}));
  const response=await send();expect(response.ok).toBe(true);const result=await response.json();
  expect(result.publicationStatus).toBe('deploying');expect(result.serverDeployment.bundle.revision.stage).toBe('released');
  const retry=await send();expect(retry.ok).toBe(true);expect(release).toHaveBeenCalledOnce();
  expect((await retry.json()).serverDeployment.bundle).toEqual(result.serverDeployment.bundle);
 }finally{await new Promise<void>(r=>server.close(()=>r()));vi.unstubAllEnvs();await rm(root,{recursive:true,force:true})}
})
