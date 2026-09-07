import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { cliRunner } from './feishu-cli.mjs';
const fail = (status,message) => { throw Object.assign(new Error(message),{status}); };
export function dashboardCard(release, share, url, note='') {
  return {schema:'2.0',config:{width_mode:'compact'},header:{template:'blue',title:{tag:'plain_text',content:release.title},subtitle:{tag:'plain_text',content:'看板分享 · 只读快照'}},body:{elements:[
    {tag:'div',text:{tag:'plain_text',content:`版本 ${share.revision}\n有效期至 ${new Date(share.expiresAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}（北京时间）`}},
    ...(note?[{tag:'div',text:{tag:'plain_text',content:note}}]:[]),
    {tag:'div',text:{tag:'plain_text',text_size:'notation',content:'持链接者可查看。请连接公司网络；过期或撤销后无法访问。'}},
    {tag:'button',text:{tag:'plain_text',content:'查看看板'},type:'primary_filled',width:'fill',behaviors:[{type:'open_url',default_url:url,pc_url:'',ios_url:'',android_url:''}]}
  ]}};
}
export async function feishuService(root, config, fetcher=fetch) {
  const file=join(root,'feishu-private.json');
  let saved={};
  try { saved=JSON.parse(await readFile(file,'utf8')); } catch(e) { if(e.code!=='ENOENT')throw e; }
  let credentials=config.feishuAppId&&config.feishuAppSecret?{appId:config.feishuAppId,appSecret:config.feishuAppSecret}:saved;
  let queue=Promise.resolve();
  const cli=config.cliRun || (config.larkCliScript?cliRunner(config.larkCliScript):null);
  const serial=fn=>{const p=queue.then(fn);queue=p.catch(()=>{});return p;};
  async function persist(path,value) { const tmp=path+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(value),{mode:0o600});await rename(tmp,path); }
  async function api(path,payload,token) {
    if(token?.startsWith('cli:')) {
      const endpoint=new URL('https://open.feishu.cn/open-apis/'+path);
      const args=['api',payload?'POST':'GET',endpoint.pathname,'--as','bot','--json'];
      if(endpoint.search)args.push('--params',JSON.stringify(Object.fromEntries(endpoint.searchParams)));
      if(payload)args.push('--data','-');
      try { const result=await cli(args,payload);return {code:0,data:result.data}; }
      catch(e){fail(502,e.message);}
    }
    let response,data;
    try { response=await fetcher('https://open.feishu.cn/open-apis/'+path,{method:payload?'POST':'GET',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(payload?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(12000)});data=await response.json(); }
    catch { fail(502,'飞书连接未完成，请稍后重试；发送重试会沿用原请求编号'); }
    if(!response.ok||data.code!==0)fail(502,`飞书请求失败（${Number(data.code)||response.status}），请检查应用凭据、机器人能力、消息权限及接收人可见范围`);
    return data;
  }
  async function token(c=credentials) {
    if(c.mode==='cli') {
      if(!cli)fail(503,'未配置本机飞书 CLI 路径');
      const state=await cli(['auth','status','--json','--verify']);
      if(state.appId!==c.appId||!state.identities?.bot?.verified)fail(503,'飞书 CLI 应用已变更或机器人身份失效，请重新配置');
      return 'cli:'+c.appId;
    }
    if(!c.appId||!c.appSecret)fail(503,'尚未配置飞书应用');
    return (await api('auth/v3/tenant_access_token/internal',{app_id:c.appId,app_secret:c.appSecret})).tenant_access_token;
  }
  return {
    status:()=>({configured:!!credentials.verifiedAt,appId:credentials.appId||'',mode:credentials.mode||'app',verifiedAt:credentials.verifiedAt||null}),
    search: async query=>{
      if(credentials.mode!=='cli'||!cli)fail(503,'搜索同事需要连接本机飞书 CLI 并授权通讯录搜索');
      if(typeof query!=='string'||!query.trim()||Array.from(query.trim()).length>50)fail(400,'请输入 1–50 个字符的姓名或工号');
      await token();
      let result;try{result=await cli(['contact','+search-user','--query',query.trim(),'--exclude-external-users','--page-size','20','--as','user','--json']);}catch{fail(502,'通讯录搜索失败，请检查飞书用户授权及通讯录可见范围');}
      return {users:(result.data?.users||[]).filter(u=>/^ou_[a-zA-Z0-9]+$/.test(u.open_id)&&!u.is_cross_tenant).map(u=>({id:u.open_id,name:u.localized_name,department:u.department||'',email:u.enterprise_email||'',matches:u.match_segments||[]})),hasMore:!!result.data?.has_more};
    },
    configure: input=>serial(async()=>{
      if(input.mode==='cli') {
        if(typeof input.appId!=='string'||!/^cli_[a-zA-Z0-9]+$/.test(input.appId))fail(400,'应用编号无效');
        const next={mode:'cli',appId:input.appId};
        await token(next);next.verifiedAt=new Date().toISOString();
        await persist(file,next);credentials=next;
        return {configured:true,mode:'cli',appId:next.appId,verifiedAt:next.verifiedAt};
      }
      if(typeof input.appId!=='string'||!/^cli_[a-zA-Z0-9]+$/.test(input.appId)||typeof input.appSecret!=='string'||input.appSecret.length<10||input.appSecret.length>256)fail(400,'请填写有效的 App ID 和 App Secret');
      const next={appId:input.appId,appSecret:input.appSecret};
      const access=await token(next);
      const bot=await api('bot/v3/info/',null,access);
      if(!bot.bot)fail(400,'请先在飞书应用中启用机器人能力');
      next.verifiedAt=new Date().toISOString();
      await persist(file,next);credentials=next;
      return {configured:true,appId:next.appId,verifiedAt:next.verifiedAt};
    }),
    send: (input,card)=>serial(async()=>{
      if(!credentials.verifiedAt)fail(503,'请先在分享弹窗中验证飞书应用配置');
      if(!['email','open_id'].includes(input.receiveIdType)||typeof input.receiveId!=='string'||!(input.receiveIdType==='open_id'?/^ou_[a-zA-Z0-9]+$/:/^\S+@[^\s@]+\.[^\s@]+$/).test(input.receiveId)||input.receiveId.length>254||typeof input.requestId!=='string'||!/^[a-zA-Z0-9-]{16,50}$/.test(input.requestId))fail(400,'请选择有效的接收人');
      const digest=createHash('sha256').update(JSON.stringify({appId:credentials.appId,email:input.receiveId,card})).digest('hex');
      const path=join(root,'feishu-send-'+input.requestId+'.json');
      let old;try{old=JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
      if(old&&old.digest!==digest)fail(409,'发送内容已改变，请关闭发送面板后重新发送');
      if(old?.messageId)return {messageId:old.messageId,reused:true};
      // Never resend an uncertain operation after Feishu's one-hour deduplication window.
      if(old&&Date.now()-old.startedAt>55*60*1000)fail(409,'上次发送结果待确认，请先在飞书确认是否收到，再重新发起');
      const access=await token();
      await persist(path,old||{digest,startedAt:Date.now()});
      const result=await api('im/v1/messages?receive_id_type='+input.receiveIdType,{receive_id:input.receiveId,msg_type:'interactive',content:JSON.stringify(card),uuid:input.requestId},access);
      if(!result.data?.message_id)fail(502,'飞书未返回消息编号，请确认接收结果');
      await persist(path,{digest,startedAt:old?.startedAt||Date.now(),messageId:result.data.message_id});
      return {messageId:result.data.message_id};
    })
  };
}
