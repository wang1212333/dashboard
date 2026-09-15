import { mkdir, readFile, writeFile, readdir, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import ts from 'typescript';
import {publishPage} from './publish-page.mjs';
const source = resolve('src/live-dashboard');
const out = resolve(process.argv[2]);
const library = resolve(process.argv[3]);
const assetId = process.argv[4];
if (assetId && !/^[a-z][a-z0-9-]{2,62}$/.test(assetId)) throw Error('Provide a released asset ID');
await mkdir(join(out,'runtime'), {recursive:true});
await mkdir(join(out,'data','live'), {recursive:true});
await mkdir(join(out,'data','releases'), {recursive:true});
await mkdir(join(out,'public'), {recursive:true});
for (const file of await readdir(source)) if (file.endsWith('.ts')) {
 const result = ts.transpileModule(await readFile(join(source,file),'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});
 // Browser-based draft validation belongs to the authoring workstation.
 // The read-only deployment must not pull Playwright into the query process.
 const code = file === 'service.ts' ? result.outputText.replace(/import \{ validateLiveRendering \} from '\.\/render-validation\.js';/, "const validateLiveRendering = async () => { throw Error('Create drafts in DSH; this server only serves released revisions'); };") : result.outputText;
 await writeFile(join(out,'runtime',file.replace(/\.ts$/,'.js')),code);
}
for (const file of ['server.mjs','dsh_server_bridge.py','install.py','README.md','publication-store.mjs','viewer-page.mjs','inline-assets.mjs']) await copyFile(join('deploy/live-server',file),join(out,file));
await writeFile(join(out,'package.json'),JSON.stringify({type:'module',private:true}));
let transport = await readFile(resolve('../codex-live-dashboard/jupyter-deploy/index.html'),'utf8');
transport=transport.slice(transport.indexOf('const appPath='),transport.indexOf('window.fetch=async function'));
transport=transport.replaceAll('codex-live-dashboard','dsh-live-server').replace('from app_bridge import run_query','from dsh_server_bridge import run_query').replace('90000','240000').replace('encodeURIComponent(location.pathname)','encodeURIComponent(location.pathname+location.search+location.hash)');
transport=transport.replace("const payload=btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(params))));","const bytes=new TextEncoder().encode(JSON.stringify(params));let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));const payload=btoa(binary);");
transport=transport.replace("text.split('\\n').find", "text.split('\\n').slice(0,-1).find");
transport=transport.replace('from dsh_server_bridge import run_query','import importlib, dsh_server_bridge; importlib.reload(dsh_server_bridge); from dsh_server_bridge import run_query');
await writeFile(join(out,'kernel-transport.js'),transport);
await writeFile(join(out,'public','publish.html'),publishPage(transport));
await writeFile(join(out,'launcher.ipynb'),JSON.stringify({cells:[],metadata:{kernelspec:{display_name:'Python 3',language:'python',name:'python3'}},nbformat:4,nbformat_minor:5}));
if(!assetId){console.log(JSON.stringify({runtimeOnly:true,out}));process.exit(0)}
const asset = JSON.parse(await readFile(join(library,'assets',assetId,'asset.json'),'utf8'));
const revision = asset.releasedRevision;
if (!/^rev-\d{4}$/.test(revision)) throw Error('Asset has no released version');
const dir = join(library,'assets',assetId,'revisions',revision);
const record = JSON.parse(await readFile(join(dir,'revision.json'),'utf8'));
if(record.stage !== 'released') throw Error('Not released');
const html = await readFile(join(dir,'dashboard.html'),'utf8');
const binding = JSON.parse(await readFile(join(library,'live',`asset-${assetId}-${revision}.json`),'utf8'));
await writeFile(join(out,'data','releases',assetId+'.json'),JSON.stringify({asset,revision:record,html}));
for(const name of [`asset-${assetId}-${revision}`,`binding-${binding.id}`]) await copyFile(join(library,'live',name+'.json'),join(out,'data','live',name+'.json'));
let bridge = await readFile(resolve('../codex-live-dashboard/jupyter-deploy/index.html'),'utf8');
bridge = bridge.slice(bridge.indexOf("const appPath="),bridge.indexOf('window.fetch=async function'));
bridge = bridge.replaceAll('codex-live-dashboard','dsh-live-server').replace('from app_bridge import run_query','from dsh_server_bridge import run_query').replace('90000','180000');
bridge += `\nwindow.fetch=async function(url,options){if(typeof url==='string' && url===${JSON.stringify('/api/dsh-workbench/live/'+binding.id+'/query')}){const data=await kernelQuery({assetId:${JSON.stringify(assetId)},payload:JSON.parse(options?.body||'{}')});return new Response(JSON.stringify(data),{status:data.error?502:200});}return normalFetch(url,options);};`;
const page = html.replace(/<head([^>]*)>/i, m=>m+'<script>'+bridge+'</script>');
await writeFile(join(out,'public',assetId+'.html'),page);
await writeFile(join(out,'launcher.ipynb'),JSON.stringify({cells:[],metadata:{kernelspec:{display_name:'Python 3',language:'python',name:'python3'}},nbformat:4,nbformat_minor:5}));
await writeFile(join(out,'manifest.json'),JSON.stringify({assetId,revision,bindingId:binding.id,builtAt:new Date().toISOString(),includesCredentials:false,includesBusinessResults:false},null,2));
console.log(JSON.stringify({assetId,revision,out}));
