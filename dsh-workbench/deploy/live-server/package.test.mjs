import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Script } from 'node:vm';
const root=resolve('../deliverables/dsh-live-server');
test('deployment includes only a released version and matching query binding',async()=>{
 const manifest=JSON.parse(await readFile(root+'/manifest.json','utf8'));
 const release=JSON.parse(await readFile(root+'/data/releases/'+manifest.assetId+'.json','utf8'));
 const binding=JSON.parse(await readFile(root+'/data/live/binding-'+manifest.bindingId+'.json','utf8'));
 assert.equal(release.revision.stage,'released');
 assert.equal(release.revision.revision,manifest.revision);
 assert.equal(binding.revision,manifest.revision);
 assert.equal(binding.assetId,manifest.assetId);
 assert.equal((await readdir(root+'/data/live')).some(x=>/share-|timing/.test(x)),false);
 assert.equal((await readdir(root)).includes('private'),false);
});
test('hosted page keeps the released HTML unchanged except for server transport',async()=>{
 const manifest=JSON.parse(await readFile(root+'/manifest.json','utf8'));
 const release=JSON.parse(await readFile(root+'/data/releases/'+manifest.assetId+'.json','utf8'));
 const page=await readFile(root+'/public/'+manifest.assetId+'.html','utf8');
 assert.equal(page.replace(/(<head[^>]*>)<script>[\s\S]*?<\/script>/i,'$1'),release.html);
 for(const match of page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new Script(match[1]);
 assert.match(page,/from dsh_server_bridge import run_query/);
 assert.match(page,/\/api\/sessions/);
});
test('read-only runtime loads without browser or DSH authoring dependencies',async()=>{
 const {LiveService}=await import(pathToFileURL(root+'/runtime/service.js').href);
 assert.equal(typeof LiveService,'function');
});
