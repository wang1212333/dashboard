// Isolated UI acceptance server: no network requests, real recipients, or access grants.
import {createServer} from 'node:http';
import {dashboardSharingBehavior} from '../dist/local-app/dashboard-sharing-ui.js';
import {liveDashboardCard} from '../deploy/online/feishu.mjs';
const sessions=new Map();
const link={token:'fixture-token',url:'https://data.example.invalid/s/acceptance-only',revision:'rev-0001',expiresAt:'2026-12-31T23:59:59Z',status:'active'};
const server=createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost');let data={};for await(const chunk of req)data.raw=(data.raw||'')+chunk;if(data.raw)data=JSON.parse(data.raw);
 const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value))};
 if(u.pathname==='/'){
  const mode=u.searchParams.get('case')||'empty',id='test-'+mode; sessions.set(id,{mode,shares:mode==='empty'||mode==='generate-failure'?[]:[{...link}],created:0,sends:[],reads:0});
  res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end('<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><title>分享弹窗 · 隔离验收</title><style>body{margin:0;background:#f5f6f8;font:13px system-ui;color:#737780}header{padding:20px}button{font:inherit}main{padding:24px}</style><header>隔离验收环境 · 所有接口为测试响应，不会发送真实消息</header><main><button id="open">打开分享弹窗</button><p id="counts"></p></main><script>'+dashboardSharingBehavior()+'</script><script>document.querySelector("#open").onclick=()=>document.dispatchEvent(new CustomEvent("dsh:share-dashboard",{detail:{id:'+JSON.stringify(id)+',title:"产销协同月度销售看板"}}));setInterval(async()=>{document.querySelector("#counts").textContent=JSON.stringify(await(await fetch("/counts/'+id+'")).json())},1000)</script></html>');
 }
 if(u.pathname.startsWith('/counts/'))return send(200,sessions.get(u.pathname.split('/').pop())||{reset:true});
 const match=/\/dashboards\/(test-[a-z-]+)\/(shares|feishu)/.exec(u.pathname);if(!match)return send(404,{});const s=sessions.get(match[1]);if(!s)return send(404,{});
 if(match[2]==='shares'){
  if(req.method==='GET'){s.reads++;if(s.mode==='list-failure'&&s.reads===1)return send(503,{error:'分享服务暂时不可用，请稍后重试'});if(s.mode==='invalid'&&s.reads>1)s.shares[0].status='revoked';return send(200,{title:'产销协同月度销售看板',revision:'rev-0001',live:true,lan:true,shares:s.shares});}
  if(req.method==='POST'){s.created++;if(s.mode==='generate-failure'&&s.created===1)return send(503,{error:'生成链接失败，请重试'});s.shares=[{...link}];return send(200,s.shares[0]);}
  if(req.method==='DELETE'){s.shares[0].status='revoked';return send(200,{revoked:true});}
 }
 if(req.method==='GET')return send(200,{configured:true,mode:'cli',appId:'cli_fixture'});
 if(data.action==='search')return send(200,{users:[{id:'ou_testuser',name:'测试同事',department:'流程与信息中心',email:'qa@example.invalid'},{id:'ou_testuser2',name:'测试同事',department:'财务部',email:'qa2@example.invalid'}],hasMore:false});
 if(data.action==='preview')return send(200,{preview:true,card:liveDashboardCard({title:'产销协同月度销售看板',revision:'rev-0001',access:'lan',url:link.url,expiresAt:link.expiresAt,note:data.note})});
 if(data.action==='send'){s.sends.push(data);if(s.mode==='send-failure'&&s.sends.length===1)return send(503,{error:'飞书消息权限暂不可用，请检查应用权限'});return send(200,{messageId:'test-only-message'});}
 return send(400,{error:'不支持的测试操作'});
});server.listen(4319,'127.0.0.1',()=>console.log('Isolated UI fixture: http://127.0.0.1:4319'));
