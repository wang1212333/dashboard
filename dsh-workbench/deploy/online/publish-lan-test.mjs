import { writeFile } from 'node:fs/promises';
const post = async (path, data) => {
  const response = await fetch('http://127.0.0.1:18087'+path, {method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+process.env.ADMIN_TOKEN},body:JSON.stringify(data)});
  const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
};
await post('/api/releases',{assetId:'lan-demo',revision:'rev-0001',title:'同事访问测试',html:'<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:16px system-ui;margin:40px;color:#262626}article{max-width:600px;margin:auto;padding:32px;border:1px solid #eee;border-radius:16px}p{color:#777}button{padding:10px 18px;cursor:pointer}</style><article><h1>看板访问成功</h1><p>这是局域网试用页面，不含业务数据。</p><button onclick="this.textContent=\'交互功能正常\'">点击验证交互</button></article></html>'});
const share = await post('/api/shares',{assetId:'lan-demo',revision:'rev-0001',days:7});
await writeFile('lan-test-share.json',JSON.stringify(share,null,2));
const response = await fetch(share.url);
if (!response.ok) throw new Error('LAN viewer check failed');
console.log(JSON.stringify({url:share.url,expiresAt:share.expiresAt,status:response.status}));
