import { feishuService, dashboardCard } from './feishu.mjs';
import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isIP } from 'node:net';

const idPattern = /^[a-z][a-z0-9-]{2,62}$/;
const revisionPattern = /^rev-\d{4}$/;
const tokenPattern = /^[a-f0-9]{48}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function read(path) { try { return JSON.parse(await readFile(path, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
async function atomic(path, value) { const temp = path + '.' + randomBytes(8).toString('hex') + '.tmp'; await writeFile(temp, JSON.stringify(value), { mode: 0o600 }); await rename(temp, path); }
async function body(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 25 * 1024 * 1024) fail(413, '请求超过 25 MB'); chunks.push(chunk); }
  try { const value = JSON.parse(Buffer.concat(chunks).toString()); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; } catch { fail(400, 'JSON 格式错误'); }
}

export async function createOnlineServer(config) {
  if (!config.adminToken || config.adminToken.length < 32 || config.adminToken.startsWith('replace-')) throw new Error('ADMIN_TOKEN 必须替换为至少 32 个字符的随机凭据');
  const publicUrl = new URL(config.publicUrl);
  if (publicUrl.search || publicUrl.hash || publicUrl.username || publicUrl.password) throw new Error('PUBLIC_URL 不得包含查询参数、凭据或锚点');
  const octets = publicUrl.hostname.split('.').map(Number);
  const privateIPv4 = isIP(publicUrl.hostname) === 4 && (octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168));
  const lanMode = config.allowLanHttp === true && privateIPv4;
  if (publicUrl.protocol !== 'https:' && !(publicUrl.protocol === 'http:' && (['localhost','127.0.0.1'].includes(publicUrl.hostname) || lanMode))) throw new Error('PUBLIC_URL 必须使用 HTTPS，局域网试用需显式启用 ALLOW_LAN_HTTP');
  const base = publicUrl.pathname.replace(/\/$/, '');
  const root = resolve(config.dataDir);
  await mkdir(join(root, 'releases'), { recursive: true });
  await mkdir(join(root, 'shares'), { recursive: true });
  const releasePath = (id, revision) => join(root, 'releases', `${id}.${revision}.json`);
  const sharePath = token => join(root, 'shares', `${hash(token)}.json`);
  const feishu = await feishuService(root, config, config.feishuFetch);
  let writes = Promise.resolve();
  const serial = task => { const next = writes.then(task); writes = next.catch(() => {}); return next; };
  const json = (res, status, value) => { res.writeHead(status, {'content-type':'application/json; charset=utf-8'}); res.end(JSON.stringify(value)); };
  const auth = req => {
    if (lanMode && !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) fail(403, '局域网试用仅允许本机发布');
    const actual = createHash('sha256').update(req.headers.authorization || '').digest();
    const expected = createHash('sha256').update('Bearer ' + config.adminToken).digest();
    if (!timingSafeEqual(actual, expected)) fail(401, '需要发布凭据');
  };
  async function activeShare(token) {
    const share = await read(sharePath(token));
    if (!share || share.revoked || Date.parse(share.expiresAt) <= Date.now()) fail(404, '分享不存在或已失效');
    return share;
  }
  async function listShares(assetId) {
    const entries = await Promise.all((await readdir(join(root, 'shares'))).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(name => read(join(root, 'shares', name))));
    return entries.filter(s => s?.assetId === assetId && s.token).map(s => ({...s,url:publicUrl.origin+base+'/s/'+s.token,status:s.revoked?'revoked':Date.parse(s.expiresAt)<=Date.now()?'expired':'active'})).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
  }
  return createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-content-type-options', 'nosniff');
    try {
      const url = new URL(req.url, 'http://localhost');
      if (base && !url.pathname.startsWith(base + '/')) fail(404, '未找到页面');
      const path = url.pathname.slice(base.length);
      if (req.method === 'GET' && path === '/healthz') return json(res, 200, {status:'ok'});
      const viewing = /^\/s\/([a-f0-9]{48})(\/content)?$/.exec(path);
      if (req.method === 'GET' && viewing) {
        const share = await activeShare(viewing[1]);
        const release = await read(releasePath(share.assetId, share.revision));
        if (!release) fail(404, '看板版本不存在');
        res.setHeader('content-type', 'text/html; charset=utf-8');
        if (viewing[2]) {
          // Published documents have an opaque origin and cannot access administration or viewer cookies.
          res.setHeader('content-security-policy', "sandbox allow-scripts allow-downloads; default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com; style-src 'unsafe-inline' https://fonts.googleapis.com; img-src data: blob:; font-src data: https://fonts.gstatic.com; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");
          return res.end(release.html);
        }
        res.setHeader('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
        return res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(release.title)}</title><style>body{margin:0;font:13px system-ui;color:#292929;height:100dvh;display:flex;flex-direction:column}header{padding:12px 18px;border-bottom:1px solid #eee}small{color:#888;margin-left:12px}iframe{border:0;width:100%;flex:1}</style><header>${escape(release.title)}<small>${escape(release.revision)} · 只读快照 · ${escape(release.publishedAt)}</small></header><iframe title="${escape(release.title)}" sandbox="allow-scripts allow-downloads" referrerpolicy="no-referrer" src="${base}/s/${viewing[1]}/content"></iframe></html>`);
      }
      if (!path.startsWith('/api/')) fail(404, '未找到页面');
      auth(req);
      if (req.method === 'GET' && path === '/api/shares') {
        const id = url.searchParams.get('assetId');
        if (!idPattern.test(id)) fail(400, '看板无效');
        return json(res, 200, {shares:await listShares(id)});
      }
      if (req.method === 'POST' && path === '/api/releases') {
        const input = await body(req);
        if (!idPattern.test(input.assetId) || !revisionPattern.test(input.revision) || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200 || typeof input.html !== 'string' || !input.html.trim()) fail(400, '发布内容不完整');
        const result = await serial(async () => {
          const target = releasePath(input.assetId, input.revision), old = await read(target);
          const digest = hash(input.html);
          if (old && (old.digest !== digest || old.title !== input.title)) fail(409, '该版本已发布，请创建新版本');
          const release = old || {assetId:input.assetId,revision:input.revision,title:input.title,html:input.html,digest,publishedAt:new Date().toISOString()};
          if (!old) await atomic(target, release);
          return {assetId:release.assetId,revision:release.revision,publishedAt:release.publishedAt};
        });
        return json(res, 200, result);
      }
      if (req.method === 'POST' && path === '/api/shares') {
        const input = await body(req);
        if (!idPattern.test(input.assetId) || !revisionPattern.test(input.revision)) fail(400, '看板或版本无效');
        if (!await read(releasePath(input.assetId, input.revision))) fail(404, '请先发布该版本');
        const days = input.days ?? 7;
        if (!Number.isInteger(days) || days < 1 || days > 30) fail(400, '有效期应为 1–30 天');
        const result = await serial(async () => {
          if (input.reuse === true) {
            const current = (await listShares(input.assetId)).find(s => s.revision === input.revision && s.status === 'active');
            if (current) return {...current,reused:true};
          }
          const token = randomBytes(24).toString('hex');
          const share = {token,assetId:input.assetId,revision:input.revision,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+days*86400000).toISOString(),revoked:false};
          await atomic(sharePath(token), share);
          return {...share,url:publicUrl.origin+base+'/s/'+token,status:'active',access:'anyone-with-link'};
        });
        return json(res, 201, result);
      }
      const revoke = /^\/api\/shares\/([a-f0-9]{48})$/.exec(path);
      if (req.method === 'DELETE' && revoke) {
        await serial(async () => { const target = sharePath(revoke[1]), share = await read(target); if (!share) fail(404, '分享不存在'); await atomic(target, {...share,revoked:true}); });
        return json(res, 200, {revoked:true});
      }
      if(req.method==='GET' && path==='/api/feishu/users') return json(res,200,await feishu.search(url.searchParams.get('q')));
      if (path === '/api/feishu/config') {
        if (req.method === 'GET') return json(res,200,feishu.status());
        if (req.method === 'POST') return json(res,200,await feishu.configure(await body(req)));
      }
      if (req.method === 'POST' && path === '/api/feishu/send') {
        const input=await body(req);
        if (!tokenPattern.test(input.token) || (input.note!==undefined && (typeof input.note!=='string'||input.note.length>500))) fail(400,'分享或附言无效');
        const share=await activeShare(input.token);
        const release=await read(releasePath(share.assetId,share.revision));
        if(!release)fail(404,'看板版本不存在');
        const card=dashboardCard(release,share,publicUrl.origin+base+'/s/'+input.token,input.note||'');
        return json(res,200,await feishu.send(input,card));
      }
      fail(404, '接口不存在');
    } catch (error) {
      json(res, error.status || 500, {error:error.status ? error.message : '服务暂时不可用'});
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = await createOnlineServer({dataDir:process.env.DATA_DIR || './data',publicUrl:process.env.PUBLIC_URL,adminToken:process.env.ADMIN_TOKEN,allowLanHttp:process.env.ALLOW_LAN_HTTP === 'true',feishuAppId:process.env.FEISHU_APP_ID,feishuAppSecret:process.env.FEISHU_APP_SECRET,larkCliScript:process.env.LARK_CLI_SCRIPT});
  server.listen(Number(process.env.PORT || 8080), process.env.HOST || '127.0.0.1', () => console.log('Online dashboard service ready'));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
