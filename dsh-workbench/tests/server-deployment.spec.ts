import {test,expect,vi,afterEach} from 'vitest'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {generateKeyPairSync,sign} from 'node:crypto'
import {ServerDeployment} from '../src/live-dashboard/server-deployment.js'
afterEach(()=>vi.unstubAllEnvs())
test('signed receipt registers exact version; forged, mismatched and expired receipts fail',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dsh-deploy-'));const key=generateKeyPairSync('ed25519');
 try{
  vi.stubEnv('DSH_SERVER_DEPLOYMENT_FILE',join(root,'config.json'));vi.stubEnv('DSH_SERVER_PUBLICATIONS_FILE',join(root,'registry.json'));
  await writeFile(join(root,'config.json'),JSON.stringify({baseUrl:'https://example.com',publicKey:key.publicKey.export({type:'spki',format:'pem'})}));
  const asset={assetId:'sample-board',displayName:'Sample',releasedRevision:'rev-0001',latestRevision:'rev-0001'};
  const stored={revision:{revision:'rev-0001',stage:'released'},html:'<html><head></head></html>'};
  const service=new ServerDeployment(root,{getAsset:async()=>asset,readRevision:async()=>stored} as any,{find:async()=>({id:'binding',spec:{}})} as any);
  const prepared=await service.prepare(asset.assetId);asset.latestRevision='rev-0002';
  const again=await service.prepare(asset.assetId);expect(again.bundle).toEqual(prepared.bundle);
  const pending=JSON.parse(await readFile(join(root,'server-deployments',prepared.nonce+'.json'),'utf8'));
  const receipt={...pending,path:'/static/dsh-live-server/sample-board/rev-0001.html',verifiedAt:new Date().toISOString()};
  const signed=(value:any)=>{const payload=Buffer.from(JSON.stringify(value)).toString('base64');return {payload,signature:sign(null,Buffer.from(payload),key.privateKey).toString('base64')}};
  await expect(service.confirm(asset.assetId,{...signed(receipt),signature:'wrong'})).rejects.toThrow('校验失败');
  await expect(service.confirm(asset.assetId,signed({...receipt,htmlSha256:'wrong'}))).rejects.toThrow('已变更');
  const result=await service.confirm(asset.assetId,signed(receipt));expect(result.url).toBe('https://example.com'+receipt.path);
  pending.expiresAt=0;await writeFile(join(root,'server-deployments',prepared.nonce+'.json'),JSON.stringify(pending));
  await expect(service.confirm(asset.assetId,signed(receipt))).rejects.toThrow('已过期');
 }finally{await rm(root,{recursive:true,force:true})}
})
