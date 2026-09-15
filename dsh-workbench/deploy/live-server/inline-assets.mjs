import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
// Bundle the chart dependencies used by DSH so viewers need no CDN access.
export async function inlineAssets(html,root){
 const tags=[...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script\s*>/gi)];
 for(const [tag,url] of tags){
  if(!/^https:\/\/cdn\.jsdelivr\.net\/npm\/(?:echarts@(?:5\.4\.3|5\.5\.0|6)\/dist\/echarts\.min\.js|chart\.js@(?:4|4\.4\.0\/dist\/chart\.umd\.min\.js|4\.4\.1\/dist\/chart\.umd\.min\.js)|papaparse@5\.4\.1\/papaparse\.min\.js)$/.test(url))throw Error('看板使用了尚未支持的外部脚本，请先将依赖内嵌到 HTML');
  const file=join(root,'vendor',createHash('sha256').update(url).digest('hex')+'.js');let script;
  try{script=await readFile(file,'utf8')}catch(e){
   if(e.code!=='ENOENT')throw e;
   const response=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('图表依赖下载失败，请重试');
   script=await response.text();if(Buffer.byteLength(script)>4000000||script.trimStart().startsWith('<'))throw Error('图表依赖内容无效');
   await mkdir(join(root,'vendor'),{recursive:true});await writeFile(file,script,{mode:0o600});
  }
  html=html.replace(tag,()=>'<script>'+script.replace(/<\/script/gi,'<\\/script')+'</script>');
 }
 if(/<script\b[^>]*\bsrc\s*=/i.test(html))throw Error('外部图表脚本格式不受支持，请内嵌脚本后发布');
 return html;
}
