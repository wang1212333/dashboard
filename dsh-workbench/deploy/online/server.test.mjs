import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOnlineServer } from './server.mjs';

test('publish authentication, immutable revisions, persisted shares, revocation, expiry and sandbox', async t => {
  const root = await mkdtemp(join(tmpdir(), 'online-test-'));
  const config = {dataDir:root,adminToken:'x'.repeat(48),publicUrl:'https://example.com/dashboards'};
  let server;
  t.after(async () => { if (server) { server.closeAllConnections(); await new Promise(r=>server.close(r)); } await rm(root,{recursive:true,force:true}); });
  async function start() { server=await createOnlineServer(config); await new Promise(r=>server.listen(0,'127.0.0.1',r)); }
  await start();
  const call = (path, method='GET', value, authenticated=true) => fetch(`http://127.0.0.1:${server.address().port}/dashboards${path}`,{method,headers:{...(authenticated?{authorization:'Bearer '+config.adminToken}:{}),'content-type':'application/json'},...(value?{body:JSON.stringify(value)}:{})});
  assert.equal((await call('/healthz')).status,200);
  const release = {assetId:'sample-board',revision:'rev-0001',title:'<img src=x>',html:'<!doctype html><h1>Test</h1><script>document.body.dataset.ready="yes"</script>'};
  assert.equal((await call('/api/releases','POST',release,false)).status,401);
  assert.equal((await call('/api/releases','POST',{...release,assetId:'../../secret'})).status,400);
  assert.equal((await call('/api/releases','POST',release)).status,200);
  assert.equal((await call('/api/releases','POST',release)).status,200);
  assert.equal((await call('/api/releases','POST',{...release,html:'changed'})).status,409);
  assert.equal((await call('/api/shares','POST',{assetId:release.assetId,revision:release.revision,days:31})).status,400);
  const share = await (await call('/api/shares','POST',{assetId:release.assetId,revision:release.revision})).json();
  const reuse = await Promise.all([1,2].map(async()=> (await call('/api/shares','POST',{assetId:release.assetId,revision:release.revision,days:30,reuse:true})).json()));
  assert.ok(reuse.every(s=>s.token===share.token && s.expiresAt===share.expiresAt));
  assert.equal((await (await call('/api/shares?assetId='+release.assetId)).json()).shares.length,1);
  assert.match(share.url,/^https:\/\/example.com\/dashboards\/s\/[a-f0-9]{48}$/);
  const viewer = await call('/s/'+share.token,'GET',null,false);
  assert.equal(viewer.status,200); assert.match(await viewer.text(),/&lt;img src=x&gt;/);
  const content = await call('/s/'+share.token+'/content','GET',null,false);
  assert.match(content.headers.get('content-security-policy'),/sandbox allow-scripts/);
  assert.match(content.headers.get('content-security-policy'),/connect-src 'none'/);
  assert.equal(await content.text(),release.html);
  server.closeAllConnections(); await new Promise(r=>server.close(r)); await start();
  assert.equal((await call('/s/'+share.token)).status,200);
  assert.equal((await call('/api/feishu/send','POST',{token:share.token,receiveIdType:'open_id',receiveId:'ou_test',requestId:'test-1'})).status,503);
  assert.equal((await call('/api/shares/'+share.token,'DELETE')).status,200);
  assert.equal((await (await call('/api/shares?assetId='+release.assetId)).json()).shares[0].status,'revoked');
  assert.equal((await call('/s/'+share.token+'/content')).status,404);
  const next = await (await call('/api/shares','POST',{assetId:release.assetId,revision:release.revision})).json();
  for (const file of await readdir(join(root,'shares'))) { const p=join(root,'shares',file), value=JSON.parse(await readFile(p)); value.expiresAt='2000-01-01T00:00:00.000Z'; await writeFile(p,JSON.stringify(value)); }
  assert.equal((await call('/s/'+next.token)).status,404);
});

test('startup rejects weak secrets and unsafe public URLs', async () => {
  await assert.rejects(createOnlineServer({adminToken:'short'}));
  await assert.rejects(createOnlineServer({adminToken:'x'.repeat(48),publicUrl:'http://example.com'}));
  await assert.rejects(createOnlineServer({adminToken:'x'.repeat(48),publicUrl:'http://example.com',allowLanHttp:true}));
  await assert.rejects(createOnlineServer({adminToken:'x'.repeat(48),publicUrl:'http://10.240.64.182'}));
});
