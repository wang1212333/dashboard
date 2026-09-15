import { filterControls } from './filter-controls.js'
import { sqlInspector } from './inspector.js'
import { Script } from 'node:vm'

/** Compile classic inline scripts without executing generated code. */
export function validateLiveScripts(html: string): void {
  let index=0
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const type=/\btype\s*=\s*["']([^"']*)["']/i.exec(match[1])?.[1].toLowerCase()
    if (type && !['text/javascript','application/javascript'].includes(type)) continue
    index++
    try { new Script(match[2],{filename:`live-page-script-${index}.js`}) }
    catch(error){throw Error(`实时页面第 ${index} 段脚本存在语法错误，请修正后保存：${(error as Error).message}`)}
  }
}

/** The generated page owns presentation; this adapter owns refresh and endpoint routing. */
export function bindLivePage(html: string, bindingId: string): string {
  if (typeof html !== 'string' || html.length > 2_000_000 || !/<\/body\s*>/i.test(html)
    || !html.includes('window.renderDSHLive') || !/id=["']dsh-live-status["']/.test(html)
    || !/id=["']dsh-live-refresh["']/.test(html)) {
    throw Error('实时页面须包含完整 HTML、window.renderDSHLive(data)、dsh-live-status 和 dsh-live-refresh 元素')
  }
  if (/data-dsh-live-runtime/.test(html)) throw Error('请提交原始模板页面，不要重复嵌入运行服务')
  validateLiveScripts(html)
  const endpoint = JSON.stringify('/api/dsh-workbench/live/' + bindingId + '/query')
  const adapter = `<script data-dsh-live-runtime>
document.addEventListener('DOMContentLoaded',()=>{
 const share=/^\\/s\\/[a-f0-9]{48}$/.test(location.pathname),endpoint=share?location.pathname+'/query':${endpoint};
 const status=document.getElementById('dsh-live-status'),button=document.getElementById('dsh-live-refresh');
 let busy=false,timer,interval=300000,last=null;
 ${filterControls()}
 async function refresh(){
  if(busy)return;busy=true;button.disabled=true;if(applyButton)applyButton.disabled=true;status.textContent=last?'正在刷新，当前展示上次成功数据…':'正在查询真实数据…';
  try{
   const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({filters:appliedFilters}),cache:'no-store',signal:AbortSignal.timeout(180000)});
   const data=await response.json();if(!response.ok)throw Error(data.error||'数据查询失败');
   if(typeof window.renderDSHLive!=='function')throw Error('页面缺少实时渲染函数');
   setupFilters(data);await window.renderDSHLive(data);document.dispatchEvent(new CustomEvent('dsh:live-data',{detail:data}));last=data;interval=data.spec.refreshSeconds*1000;
   status.textContent='更新于 '+new Date(data.queriedAt).toLocaleString('zh-CN')+' · '+(data.durationMs/1000).toFixed(2)+' 秒 · 数据校验通过';
  }catch(error){status.textContent=error.message+(last?' · 新条件未加载成功，仍显示上次结果；上次成功查询 '+new Date(last.queriedAt).toLocaleString('zh-CN'):' · 暂无可展示数据');}
  finally{busy=false;button.disabled=false;if(applyButton)applyButton.disabled=optionLoads>0;clearTimeout(timer);timer=setTimeout(()=>{if(!document.hidden)refresh()},interval);}
 }
 button.addEventListener('click',refresh);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});refresh();
});</script>`
  return html.replace(/<\/body\s*>/i, sqlInspector() + adapter + '</body>')
}

export const livePageContract = `每张图表的可见标题必须添加 data-sql-title="该图表的data-sql-source稳定ID"，标题与绘图区关联同一provenance条目；标题是打开查询SQL抽屉的入口，不新增说明按钮，绘图区保留自身交互。新看板优先使用spec.queries独立查询组，页面从data.results[queryId]读取数组，每组有独立metrics（m0起）、groupBy（bucket/d1/d2），provenance.query填写对应q_查询ID。以下totals/trend/ranking格式及Top20说明仅适用于未声明queries的旧兼容模式。筛选组件由系统统一维护，使用紧凑下拉面板，不自行生成筛选器或覆盖其内部结构。请在 :root 或 #dsh-live-filters 上设置与当前模板一致的 CSS 主题变量：--dsh-filter-text、--dsh-filter-muted、--dsh-filter-bg、--dsh-filter-surface（不透明浮层底色）、--dsh-filter-border、--dsh-filter-hover、--dsh-filter-accent、--dsh-filter-on-accent、--dsh-filter-focus、--dsh-filter-font、--dsh-filter-radius、--dsh-filter-height。未配置时使用暖灰默认主题，深色模板必须提供相应背景和文字对比色。筛选容器及祖先不得裁剪下拉浮层；桌面、窄屏与长选项验收须检查按钮不竖排、不溢出、主题一致。渲染函数必须可重复调用：空数据时清除旧图、旧合计；负数不得生成负宽度或饼图占比，可改为明确的负数提示；动态属性必须完整转义引号或使用DOM API。金额币种和数量单位没有业务证据时不得标注为元或台。按本轮所选模板规范自主生成完整、自包含 HTML，保留模板的排版、配色和图表语言。页面必须定义 window.renderDSHLive = function(data) { ... }；每次刷新调用它，更新现有指标和图表，避免重复追加节点。数据格式：data.spec={title,metrics:[{label,field,aggregate,definition,unit?}],dateField?,dimension?,filters?,refreshSeconds}; data.totals=[{m0,m1,...,records,data_date?}]; data.trend=[{bucket,m0,m1,...}]; data.ranking=[{bucket,m0,m1,...}]; data.queriedAt、durationMs、validated；data.appliedFilters是本次成功加载的筛选值，范围标题应据此更新。ranking 只包含按第一个指标排序的前 20 项，不是所有维度成员；不得将 ranking.length 宣称为全量国家数，不得将其中第二指标的排序宣称为全量排名；应明确样本范围。m0/m1 按 metrics 顺序对应；值可能是数字字符串或 null，null 展示为 —；latest_sum 不存在趋势值。必须包含 id="dsh-live-status" 的可见状态元素和 id="dsh-live-refresh" 的按钮，它们由运行服务维护。所有业务数值仅在 renderDSHLive 内从 data 渲染，初始页面使用等待占位，不得写死示例值或编造同比。只展示 spec 明确定义的业务指标；不得为了填满模板新增转化率、激活率、达成率或跨指标相除，尤其不能把不同口径的发货量与激活量直接相除。模板中的百分比仪表、引言和结论必须删除或替换为已有指标的适配图表，不能照搬、限幅伪造百分比或推断因果。页面交互筛选由服务统一提供：按实际数据集字段在spec声明interactiveFilters（类型及参数见能力查询），不要照搬固定国家示例，并在模板合适位置放置id="dsh-live-filters"容器，服务自动生成控件、应用/恢复默认按钮及查询。不自行编写请求和筛选控件。所有图表必须在每次renderDSHLive时使用本次data重绘，空结果清除旧值。不得自行 fetch、定时刷新、写入数据源凭据或固定查询地址；服务注入刷新与授权路由。桌面与手机采用响应式重排；不得使用 zoom 或 transform 把整页缩小来适配手机，图表需同步适配可用宽度并保持文字可读。CSS、JavaScript、SVG 必须内联，不使用 CDN、远程字体、外部脚本或相对资源；可用内联 SVG 或 Canvas 实现模板图表。动态文本使用 textContent 或安全转义。将表名、原始字段及运算符转为业务文案，详细口径放在折叠说明中。每个图表、业务数字、表格数值区域必须标记 data-sql-source="稳定ID"；同时提交 provenance={elements:[{id,title,query:"totals",fields:["m0"],processing:"真实前端计算步骤，无额外计算也须说明"}]}。queries模式下query必须填写已声明的查询ID；旧模式query只能填写totals、trend、ranking之一，不能填写带竖线的联合字符串；fields是非空返回别名数组，例如["m0"]，不能用物理字段名。每个 ID 必须在静态 HTML 中有容器，对应关系必须覆盖所有业务指标；动态表格可在子单元格重复使用 ID。切换指标时同步更新 data-sql-fields="m1"（必须属于已声明 fields）和 data-sql-context（当前筛选说明）。禁止自己添加 SQL 图标、抽屉或 SQL 文本，统一运行服务自动提供点击查看。SQL 只对工作台访问者展示，分享链接默认不返回 SQL。提交 provenance、html 与 spec 给 workbench_preflight_live_dashboard；完整预检返回 planId 后，仅提交 planId 和 assetId 给 workbench_create_live_dashboard，预览、发布和分享保留该 HTML 设计。`
