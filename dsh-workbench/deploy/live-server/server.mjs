import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { LiveService } from './runtime/service.js';
import { startLiveShareServer } from './runtime/sharing.js';
import { publicationStore, signingKey } from './publication-store.mjs';
import { createPublicKey } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = resolve(process.env.DSH_SERVER_DATA || new URL('./data', import.meta.url).pathname);
const appRoot=fileURLToPath(new URL('.',import.meta.url));
const valid = (id, rev) => /^[a-z][a-z0-9-]{2,62}$/.test(id) && /^rev-\d{4}$/.test(rev);
const library = {
 async getAsset(id) {
  if (!valid(id, 'rev-0001')) throw Error('Invalid asset');
  return JSON.parse(await readFile(join(root, 'releases', id + '.json'), 'utf8')).asset;
 },
 async readRevision(id, rev) {
  if (!valid(id, rev)) throw Error('Invalid revision');
  return publications.readRevision(id,rev);
 }
};
const live = new LiveService(root, library);
const publications=publicationStore(appRoot,live);
const server = createServer(async (req, res) => {
 res.setHeader('content-type', 'application/json');
 res.setHeader('cache-control', 'no-store');
 const send = (status, body) => {res.writeHead(status);res.end(JSON.stringify(body));};
 if (req.method === 'GET' && req.url === '/healthz') return send(200, {status:'ok',runtime:'dsh-live-server',version:2});
 if(req.method==='GET'&&req.url==='/publication-key')return send(200,{publicKey:createPublicKey(await signingKey(appRoot)).export({type:'spki',format:'pem'})});
 if (req.method !== 'POST' || !['/query','/publish'].includes(req.url)) return send(404, {error:'Not found'});
 try {
  let body = ''; for await (const chunk of req) {body += chunk;if (Buffer.byteLength(body) > (req.url==='/publish'?5000000:65536)) throw Error('Request too large');}
  const input = JSON.parse(body);
  if(req.url==='/publish')return send(200,await publications.publish(input));
  const asset = await library.getAsset(input.assetId);
  const version=input.revision||asset.releasedRevision;
  await library.readRevision(asset.assetId,version);
  const binding = await live.find(asset.assetId, version);
  if (!binding) throw Error('Missing live release');
  const result = await live.request(binding.id, input.payload || {});
  send(200, result);
 } catch (error) {console.error('Query failed:', error.message);send(502, {error:'服务器查询失败，请检查授权、版本和数据源状态'});}
});
// Management/query bridge is loopback-only. Jupyter authenticates the caller.
server.listen(Number(process.env.DSH_SERVER_PORT || 4341), '127.0.0.1');
process.env.DSH_LIVE_SHARE_HOST ||= '127.0.0.1';
process.env.DSH_LIVE_SHARE_PORT ||= '4342';
const shares = startLiveShareServer(live);
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => {server.close();shares.close();});
