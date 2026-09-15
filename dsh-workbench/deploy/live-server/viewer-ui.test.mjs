import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Script} from 'node:vm';
const root=resolve('../deliverables/dsh-live-server-v4');
const {viewerPage}=await import(pathToFileURL(join(root,'viewer-page.mjs')));
const {withCurrentLiveUI,withEmbeddedQueryBridge}=await import(pathToFileURL(join(root,'runtime/preview-bridge.js')));
test('server and local preview apply the identical filter and SQL inspector UI',async()=>{
 const html='<html><head></head><body><script data-dsh-live-runtime> let appliedFilters,filterForm,applyButton,optionLoads=0;function setupFilters(data){} async function refresh(){}</script></body></html>';
 const expected=withCurrentLiveUI(html);
 const local=withEmbeddedQueryBridge(html,'binding').replace(/<script data-dsh-preview-bridge>[\s\S]*?<\/script>/,'');
 assert.equal(local,expected);
 const page=await viewerPage({assetId:'sample-board',revision:'rev-0001',html,bindingId:'binding'},root);
 const framed=Buffer.from(page.match(/atob\('([^']+)'\)/)[1],'base64').toString();
 assert.equal(framed.replace(/<meta http-equiv="Content-Security-Policy"[^>]*><script>[\s\S]*?<\/script>/,''),expected);
 for(const match of framed.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new Script(match[1]);
});
