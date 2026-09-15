import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID,createPublicKey,verify,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {Script} from 'node:vm';
const root=resolve('../deliverables/dsh-live-server-v3');
const {publicationStore,signingKey}=await import(pathToFileURL(root+'/publication-store.mjs').href);
const {fingerprint}=await import(pathToFileURL(root+'/runtime/mcp.js').href);
const source={url:'https://example.com',token:'test'};
const spec={title:'Sample',datasource:'test',table:'public.sales',metrics:[{field:'amount',aggregate:'sum',label:'Sales',definition:'Sum'}],filters:[],refreshSeconds:60};
function bundle(rev='rev-0001',id='sample-board'){return {asset:{assetId:id,releasedRevision:rev},revision:{revision:rev,stage:'released'},html:'<html><head></head><body>Sample</body></html>',binding:{id:randomUUID(),assetId:id,revision:rev,scope:fingerprint(source),spec}}}
test('two boards and versions publish independently; retry, signature, collision and scope are checked',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dsh-publish-'));let count=0;
 try{
  const store=publicationStore(dir,{trial:async()=>{count++;return {validated:true,queries:{totals:'SELECT 1'},dialect:'postgresql'}}},{source:async()=>source,makePage:async()=>'<html>viewer</html>'});
  const first=bundle(),nonce=randomUUID();const receipt=await store.publish({bundle:first,nonce});
  assert.ok(verify(null,Buffer.from(receipt.payload),createPublicKey(await signingKey(dir)),Buffer.from(receipt.signature,'base64')));
  await store.publish({bundle:{...first,asset:{...first.asset,displayName:'New title'}},nonce:randomUUID()});assert.equal(count,2);
  const second=bundle('rev-0002');await store.publish({bundle:second,nonce:randomUUID()});
  await store.publish({bundle:bundle('rev-0001','other-board'),nonce:randomUUID()});
  assert.equal((await store.readRevision('sample-board','rev-0001')).html,first.html);
  assert.equal(JSON.parse(await readFile(join(dir,'data/releases/sample-board.json'),'utf8')).revision.revision,'rev-0001');
  await assert.rejects(store.publish({bundle:{...first,html:first.html+'changed'},nonce:randomUUID()}),/内容不同/);
  const collision=bundle('rev-0003');collision.binding.id=first.binding.id;await assert.rejects(store.publish({bundle:collision,nonce:randomUUID()}),/冲突/);
  const bad=bundle();bad.binding.scope='wrong';await assert.rejects(store.publish({bundle:bad,nonce:randomUUID()}),/授权/);
  const failed=publicationStore(dir,{trial:async()=>({validated:false})},{source:async()=>source});await assert.rejects(failed.publish({bundle:bundle('rev-0004'),nonce:randomUUID()}),/未通过/);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('publisher JavaScript compiles and viewer isolates generated HTML',async()=>{
 const html=await readFile(join(root,'public/publish.html'),'utf8');for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new Script(m[1]);
 const {viewerPage}=await import(pathToFileURL(root+'/viewer-page.mjs').href);const page=await viewerPage({assetId:'sample-board',revision:'rev-0001',html:bundle().html,bindingId:randomUUID()},root);
 assert.match(page,/sandbox="allow-scripts"/);assert.doesNotMatch(page,/allow-same-origin/);for(const m of page.matchAll(/<script>([\s\S]*?)<\/script>/g))new Script(m[1]);
});
test('chart dependencies use cached code and unknown external scripts fail closed',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dsh-assets-'));
 try{
  const {inlineAssets}=await import(pathToFileURL(root+'/inline-assets.mjs').href);
  const url='https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js';
  await mkdir(join(dir,'vendor'));await writeFile(join(dir,'vendor',createHash('sha256').update(url).digest('hex')+'.js'),'window.echarts={version:"5.5.0"};');
  const result=await inlineAssets('<script src="'+url+'"></script>',dir);assert.match(result,/window.echarts/);assert.doesNotMatch(result,/src=/);
  await assert.rejects(inlineAssets('<script src="https://untrusted.example/a.js"></script>',dir),/尚未支持/);
 }finally{await rm(dir,{recursive:true,force:true})}
});
