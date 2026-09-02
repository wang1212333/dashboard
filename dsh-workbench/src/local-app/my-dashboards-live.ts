import { myDashboardsBehavior as originalMyDashboardsBehavior } from './my-dashboards.js'

/**
 * Preserve the existing, reviewed “我的看板” presentation and replace only its
 * old hard-coded seed with the server-backed asset list.
 */
export function myDashboardsBehavior(): string {
  const script = originalMyDashboardsBehavior()
  const historyEnhancer = String.raw`(()=>{const normalizeTitle=value=>{const title=String(value||'').replace(/^生成看板[：:]\s*/,'').trim();return !title||/^(sample|summary(?:[_-].*)?)$/i.test(title)?'数据看板搭建':title};const enhance=()=>{const section=document.querySelector('.sidebar-history');if(!section)return;const entries=[...section.querySelectorAll('.history-item')];entries.forEach((entry,index)=>{const title=entry.querySelector('strong');if(title)title.textContent=normalizeTitle(title.textContent);entry.hidden=section.dataset.historyExpanded!=='true'&&index>4});let toggle=section.querySelector('.history-more');if(entries.length<=5){toggle?.remove();return}if(!toggle){toggle=document.createElement('button');toggle.type='button';toggle.className='history-more';toggle.addEventListener('click',()=>{section.dataset.historyExpanded=section.dataset.historyExpanded==='true'?'false':'true';enhance()});section.append(toggle)}toggle.textContent=section.dataset.historyExpanded==='true'?'收起最近对话':'查看全部'};const syncBoardNav=()=>{if(!document.querySelector('.my-dashboards'))return;document.querySelectorAll('.nav-item').forEach(item=>item.classList.toggle('active',item.dataset.page==='boards'))};new MutationObserver(()=>{enhance();syncBoardNav()}).observe(document.body,{childList:true,subtree:true});enhance();syncBoardNav()})()`
  const fetcher = String.raw`async function loadLiveDashboards(){state.loading=true;render();try{const response=await fetch('/api/dashboards');if(!response.ok)throw new Error('LIST_REQUEST_FAILED:'+response.status);const payload=await response.json();const previewKind=item=>item.templateId==='finance-pnl-v1'?'finance':item.templateId==='supply-sales-v1'?'regional':item.templateId==='sku-operations-v1'?'operations':'funnel';const displayTime=value=>{const date=new Date(value);return Number.isNaN(date.valueOf())?String(value||'—'):new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(date)};state.items=(Array.isArray(payload.dashboards)?payload.dashboards:[]).map(item=>({id:item.id,title:item.title,description:item.description||'',status:'published',currentVersion:1,previewKind:previewKind(item),previewKpis:Array.isArray(item.previewKpis)?item.previewKpis:[],updatedAt:displayTime(item.updatedAt),publishedAt:displayTime(item.updatedAt),isFavorite:false,ownerId:'me',ownerName:'我',sourceConversationName:'看板搭建',dashboardUrl:item.dashboardUrl}));}catch(error){state.items=[];toast('看板列表加载失败')}finally{state.loading=false;render()}}`
  const oldBoardClick = "state.loading=true;url({page:'boards'});render();setTimeout(()=>{state.loading=false;render()},180)"
  const oldInitialLoad = "window.addEventListener('popstate',()=>{init();render()});init();if(params().get('page')==='boards'){state.loading=true;render();setTimeout(()=>{state.loading=false;render()},180)}"
  const oldPrimaryAction = "host.querySelectorAll('[data-primary]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();open(b.dataset.primary,b)}))"
  const previewStart = 'preview=x=>{'
  const previewEnd = '},star=x=>'
  const start = script.indexOf(previewStart)
  const end = script.indexOf(previewEnd, start)
  if (!script.includes(oldBoardClick) || !script.includes(oldInitialLoad) || !script.includes(oldPrimaryAction) || start < 0 || end < 0) throw new Error('MY_DASHBOARDS_LEGACY_LAYOUT_CHANGED')
  const livePreview = String.raw`preview=x=>'<div class="dash-preview dashboard-live-preview"><iframe class="dashboard-preview-frame" src="'+escape(x.dashboardUrl||'')+'" title="'+escape(x.title)+' 看板缩略预览" loading="lazy" sandbox="allow-scripts" tabindex="-1"></iframe></div>'`
  const withDataPreview = `${script.slice(0, start)}${livePreview}${script.slice(end + 1)}`
  const liveScript = withDataPreview
    .replace(oldBoardClick, "url({page:'boards'});loadLiveDashboards()")
    .replace(oldInitialLoad, `window.addEventListener('popstate',()=>{init();if(params().get('page')==='boards')loadLiveDashboards();else render()});${fetcher}init();if(params().get('page')==='boards')loadLiveDashboards()`)
    .replace(oldPrimaryAction, "host.querySelectorAll('[data-primary]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();const x=state.items.find(i=>i.id===b.dataset.primary);if(x?.dashboardUrl)location.assign(x.dashboardUrl);else open(b.dataset.primary,b)}))")
  return `${liveScript};${historyEnhancer}`
}

/** A real dashboard document is rendered inside a safely isolated card viewport. */
export function myDashboardsLiveStyles(): string {
  return `.my-dashboards .dashboard-live-preview{position:relative;padding:0;background:#f7f8fa}.my-dashboards .dashboard-preview-frame{position:absolute;top:0;left:0;width:400%;height:400%;border:0;background:#fff;pointer-events:none;transform:scale(.25);transform-origin:top left}.my-dashboards .dash-row .dashboard-live-preview{padding:0}.my-dashboards .dash-row .dashboard-preview-frame{width:400%;height:400%}.my-dashboards .dash-star.is-favorite{color:#f5a623}.my-dashboards .dash-star.is-favorite:hover{background:#fff7e6;color:#d98b00}`
}
