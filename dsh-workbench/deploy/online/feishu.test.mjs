import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {feishuService,dashboardCard} from './feishu.mjs';
test('CLI configuration uses bot identity without exporting secrets and rejects switched apps',async t=>{
 const root=await mkdtemp(join(tmpdir(),'feishu-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
 let appId='cli_example',sent=0;
 const cliRun=async(args,input)=>{
   if(args[0]==='auth')return {appId,identities:{bot:{verified:true}}};
   if(args[0]==='contact'){assert.ok(args.includes('user'));return {data:{users:[{open_id:'ou_test',localized_name:'同事',department:'部门',enterprise_email:'test@example.com'}],has_more:true}};}
   assert.ok(args.includes('bot'));assert.equal(input.msg_type,'interactive');sent++;return {ok:true,data:{message_id:'om_cli'}};
 };
 const service=await feishuService(root,{cliRun});
 await service.configure({mode:'cli',appId});assert.equal(sent,0);
 const found=await service.search('同事');assert.equal(found.users[0].id,'ou_test');assert.equal(found.hasMore,true);await assert.rejects(service.search(''));
assert.equal(service.status().mode,'cli');
 await service.send({receiveIdType:'open_id',receiveId:'ou_test',requestId:'12345678-1234-1234-1234-123456789012'},{});assert.equal(sent,1);
 appId='cli_other';await assert.rejects(service.send({receiveIdType:'email',receiveId:'test@example.com',requestId:'22345678-1234-1234-1234-123456789012'},{}),/变更/);
});
test('configuration is validated and redacted; sends are deduplicated across restart',async t=>{
 const root=await mkdtemp(join(tmpdir(),'feishu-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
 let sends=0;let payload;
 const fake=async(url,options)=>{
  if(url.includes('tenant_access_token'))return Response.json({code:0,tenant_access_token:'private'});
  if(url.includes('bot/v3/info'))return Response.json({code:0,bot:{app_name:'test'}});
  sends++;payload=JSON.parse(options.body);return Response.json({code:0,data:{message_id:'om_test'}});
 };
 let service=await feishuService(root,{},fake);
 assert.equal(service.status().configured,false);
 const configured=await service.configure({appId:'cli_example',appSecret:'secret-example-123'});
 assert.equal(configured.configured,true);assert.ok(!JSON.stringify(configured).includes('secret'));assert.equal(sends,0);
 const card=dashboardCard({title:'看板'},{revision:'rev-0001',expiresAt:'2026-10-01T00:00:00Z'},'http://10.1.1.1:18087/s/test','附言');
 const input={receiveIdType:'email',receiveId:'test@example.com',requestId:'12345678-1234-1234-1234-123456789012'};
 await service.send(input,card);service=await feishuService(root,{},fake);
 await service.send(input,card);assert.equal(sends,1);assert.equal(payload.msg_type,'interactive');assert.equal(JSON.parse(payload.content).schema,'2.0');
 await assert.rejects(service.send({...input,receiveId:'other@example.com'},card),/内容已改变/);
});
test('failed configuration never enables sending or persists credentials',async t=>{
 const root=await mkdtemp(join(tmpdir(),'feishu-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const service=await feishuService(root,{},async()=>Response.json({code:10003,msg:'private-secret'}));
 await assert.rejects(service.configure({appId:'cli_example',appSecret:'secret-example-123'}),e=>!e.message.includes('private-secret'));
 assert.equal(service.status().configured,false);
 assert.equal((await feishuService(root,{})).status().configured,false);
});
