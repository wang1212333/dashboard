import { spawn } from 'node:child_process';

// The executable is configured locally, never accepted from browser input.
export function cliRunner(script) {
  return (args, input) => new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[script,...args],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,LARKSUITE_CLI_NO_UPDATE_NOTIFIER:'1',LARKSUITE_CLI_NO_SKILLS_NOTIFIER:'1'}});
    let output='',errors='',settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
    const timer=setTimeout(()=>{child.kill();finish(new Error('飞书 CLI 响应超时，请重试并核对接收结果'));},22000);
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>2e6)child.kill();});
    child.stderr.on('data',chunk=>{errors+=chunk;if(errors.length>2e6)child.kill();});
    child.on('error',()=>finish(new Error('无法启动本机飞书 CLI')));
    child.stdin.on('error',()=>{});
    child.on('close',code=>{
      try {const result=JSON.parse(output);if(code===0&&result.ok!==false)return finish(null,result);}catch{}
      // Never return raw CLI output: it can contain credentials or private diagnostics.
      let detail='';try{const error=JSON.parse(errors||output).error;detail=error?.code?`（${Number(error.code)}）`:'';}catch{}
      finish(new Error('飞书请求失败'+detail+'，请检查机器人消息权限及接收人可见范围'));
    });
    child.stdin.end(input===undefined?'':JSON.stringify(input));
  });
}
