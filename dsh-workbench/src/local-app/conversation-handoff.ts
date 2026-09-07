/**
 * Keeps a submitted request immutable in the conversation while resetting the
 * composer for the next turn. The base shell is intentionally shared with the
 * DSH iframe host, so these replacements cover both its host and local paths.
 */
export function applyConversationHandoff(page: string): string {
  return page
    .replaceAll(
      "'<div class=\"chat-thread\"><div class=\"user-message\">'+escapeHtml(state.stream.question)+'</div>'+agentAnswer()+'</div>'",
      "'<div class=\"chat-thread\">'+conversationTurnsHtml()+'</div>'",
    )
    .replace(
      "function beginLiveStream(question){state.streamState='planning';state.sending=true;state.stream={live:true,question,name:true,planText:'',tools:[],findings:[],lists:[],artifacts:[]};refreshStream()}",
      "function beginLiveStream(question,attachmentName){state.streamState='planning';state.sending=true;state.followOutput=true;state.stream={live:true,question,name:true,attachmentName:attachmentName||'',planText:'',tools:[],findings:[],lists:[],artifacts:[]};state.conversationTurns=Array.isArray(state.conversationTurns)?state.conversationTurns:[];state.conversationTurns.push({stream:state.stream});refreshStream()}",
    )
    .replace(
      'function newPage(){',
      "function conversationTurnsHtml(){const turns=Array.isArray(state.conversationTurns)&&state.conversationTurns.length?state.conversationTurns:(state.stream?[{stream:state.stream}]:[]);return turns.map((turn,index)=>{const stream=turn.stream||turn,currentStream=state.stream,currentSending=state.sending;state.stream=stream;state.sending=index===turns.length-1?currentSending:false;const answer=agentAnswer();state.stream=currentStream;state.sending=currentSending;return '<section class=\"conversation-turn\"><div class=\"user-message\">'+(stream.attachmentName?'<span class=\"sent-attachment\">'+icons.document+'<strong>'+escapeHtml(stream.attachmentName)+'</strong></span>':'')+'<span class=\"user-message-text\">'+escapeHtml(stream.question)+'</span></div>'+answer+'</section>'}).join('')}function newPage(){",
    )
    .replace(
      /state\.draft=prompt\|\|'请根据上传数据生成一张看板。';\s*state\.requestId=crypto\.randomUUID\(\);\s*beginLiveStream\(state\.draft\);\s*try\{\s*const api=/,
      "const selectedFile=state.file;state.draft=prompt||'请根据上传数据生成一张看板。';state.requestId=crypto.randomUUID();const sentQuestion=state.draft;state.file=null;state.draft='';beginLiveStream(sentQuestion,selectedFile.name);try{const api=",
    )
    .replace(
      "body:JSON.stringify({csv:await state.file.text(),fileName:state.file.name})",
      "body:JSON.stringify({csv:await selectedFile.text(),fileName:selectedFile.name})",
    )
    .replaceAll("title:'生成看板：'+state.file.name", "title:'生成看板：'+selectedFile.name")
    .replace(
      "state.draft=prompt||'请根据上传数据生成一张看板。';beginLiveStream(state.draft);state.abortController=new AbortController();try{const csv=await state.file.text(),uploadResponse=",
      "const selectedFile=state.file;state.draft=prompt||'请根据上传数据生成一张看板。';const sentQuestion=state.draft;state.file=null;state.draft='';beginLiveStream(sentQuestion,selectedFile.name);state.abortController=new AbortController();try{const csv=await selectedFile.text(),uploadResponse=",
    )
    .replace(
      "body:JSON.stringify({csv,fileName:state.file.name})",
      "body:JSON.stringify({csv,fileName:selectedFile.name})",
    )
    .replaceAll('intent:state.draft', 'intent:sentQuestion')
    .replace('const historyTitle=state.file?.name?.replace', "const historyTitle=(state.stream?.attachmentName||'数据看板').replace")
    .replace(
      'streamState:state.streamState};saveHistory(state.history)}',
      'streamState:state.streamState,turns:state.conversationTurns,dashboardAgentSessionId:state.dashboardAgentSessionId,dashboardAgentUploadId:state.dashboardAgentUploadId};saveHistory(state.history)}',
    )
    .replace(
      'state.sessionId=item.sessionId;state.timeline=',
      'state.sessionId=item.sessionId;state.dashboardAgentSessionId=item.dashboardAgentSessionId||item.sessionId;state.dashboardAgentUploadId=item.dashboardAgentUploadId;state.conversationTurns=Array.isArray(item.turns)?item.turns:[];state.timeline=',
    )
    .replace(
      'state.stream=item.stream||completedStream(item.title);if(state.stream){',
      'state.stream=item.stream||completedStream(item.title);if(!state.conversationTurns.length&&state.stream)state.conversationTurns=[{stream:state.stream}];if(state.stream){',
    )
    .replace(
      "const dashboardAgentApi=()=>isHostWorkbench()?'/api/dsh-workbench':'/api';\n  function applyHeadlessAgentEvent(event){",
      "const dashboardAgentApi=()=>isHostWorkbench()?'/api/dsh-workbench':'/api';\n  const isCurrentUpload=()=>false;\n  function applyHeadlessAgentEvent(event){",
    )
    .replace(
      "const dashboardAgentApi=()=>isHostWorkbench()?'/api/dsh-workbench':'/api';\n  const isCurrentUpload=",
      "const dashboardAgentApi=()=>isHostWorkbench()?'/api/dsh-workbench':'/api';\n  const leakedHttpError=value=>/(?:^|[\\r\\n])\\s*(?:[45]\\d{2}\\s+)?<!doctype\\s+html\\b/i.test(String(value||'').slice(0,2048));\n  const upstreamReplyError='数据已读取，但回答生成服务返回了异常响应。请重试。';\n  function ensureConversationHistory(){const logicalId=state.sessionId||state.dashboardAgentSessionId;if(!logicalId)return;if(!state.sessionId)state.sessionId=logicalId;const current=state.history.find(item=>item.sessionId===logicalId);const title=current?.title||'生成看板：'+(state.stream?.attachmentName||state.stream?.question?.slice(0,24)||'数据看板');const record={...current,updatedAt:Date.now(),activityAt:Date.now(),sessionId:logicalId,title,createdAt:current?.createdAt||Date.now(),timeline:state.timeline,activity:state.activity,runState:state.runState||'running',stream:state.stream,streamState:state.streamState,turns:state.conversationTurns,dashboardAgentSessionId:state.dashboardAgentSessionId||logicalId,dashboardAgentUploadId:state.dashboardAgentUploadId};state.history=[record,...state.history.filter(item=>item.sessionId!==logicalId)];saveHistory(state.history);renderHistory()}\n  const isCurrentUpload=",
    )
    .replace(
      "function applyHeadlessAgentEvent(event){",
      "function hideRestoredHttpError(stream){if(!stream||!leakedHttpError(stream.output))return false;stream.output='';stream.error=upstreamReplyError;stream.live=false;return true}function sanitizeRestoredFailures(){let changed=hideRestoredHttpError(state.stream);(state.conversationTurns||[]).forEach(turn=>{if(hideRestoredHttpError(turn?.stream||turn))changed=true});(state.history||[]).forEach(item=>{if(hideRestoredHttpError(item.stream))changed=true;(item.turns||[]).forEach(turn=>{if(hideRestoredHttpError(turn?.stream||turn))changed=true})});if(changed){state.sending=false;state.streamState='error';state.activity='';saveHistory(state.history)}}sanitizeRestoredFailures();function applyHeadlessAgentEvent(event){",
    )
    .replace(
      "else if(event.type==='assistant.delta'){state.stream.output=(state.stream.output||'')+(data.text||'');state.activity='正在回答';}",
      "else if(event.type==='assistant.delta'){const text=String(data.text||'');if(leakedHttpError(text)){state.sending=false;state.streamState='error';state.stream.output='';state.stream.error=upstreamReplyError;state.activity='';}else{state.stream.output=(state.stream.output||'')+text;state.activity='正在回答';}}",
    )
    .replace(
      "function assistantParagraphs(text){return String(text||'').split(String.fromCharCode(10)).map(part=>part.trim()).filter(Boolean).map(part=>'<p class=\"agent-block agent-output\">'+escapeHtml(part)+'</p>').join('')}",
      "function assistantParagraphs(text){const raw=String(text||'');if(/(?:^|[\\r\\n])\\s*(?:[45]\\d{2}\\s+)?<!doctype\\s+html\\b/i.test(raw.slice(0,2048)))return '';return raw.split(String.fromCharCode(10)).map(part=>part.trim()).filter(Boolean).map(part=>'<p class=\"agent-block agent-output\">'+escapeHtml(part)+'</p>').join('')}",
    )
    .replace(
      'state.dashboardAgentSessionId=created.sessionId;',
      'state.dashboardAgentSessionId=created.sessionId;state.sessionId=created.sessionId;ensureConversationHistory();',
    )
    .replace(
      "if(event.type==='session.started'){state.dashboardAgentSessionId=data.sessionId||state.dashboardAgentSessionId;state.activity='已连接看板智能体';}",
      "if(event.type==='session.started'){const agentSessionId=data.sessionId||state.dashboardAgentSessionId;const replaced=Boolean(agentSessionId&&agentSessionId!==state.dashboardAgentSessionId);state.dashboardAgentSessionId=agentSessionId;if(!state.sessionId)state.sessionId=agentSessionId;if(replaced)ensureConversationHistory();state.activity=replaced?'服务已恢复会话，正在继续回复':'已连接看板智能体';}",
    )
    .replace(
      "else if(event.type==='tool.completed'){toolFor('headless:'+data.callId,data.title||'看板工具',data.failed?'failed':'completed');state.activity=data.failed?'工具执行失败':(data.title||'工具执行完成');}",
      "else if(event.type==='tool.completed'){toolFor('headless:'+data.callId,data.title||'看板工具',data.failed?'failed':'completed');state.activity=data.failed?'工具执行失败':(data.title||'工具执行完成');}else if(event.type==='dashboard.draft.ready'){state.stream.dashboardDraft={assetId:data.assetId,revision:data.revision,title:data.title,previewed:false,released:false};state.activity='看板草稿已生成，等待你预览确认';}",
    )
    .replace(
      "if(s.error)html+='<p class=\"agent-block agent-error\">'+escapeHtml(s.error)+'</p>';",
      "if(s.dashboardDraft){const draft=s.dashboardDraft;html+='<section class=\"dashboard-draft-actions\"><div><strong>'+escapeHtml(draft.title||'看板草稿')+'</strong><span>'+escapeHtml(draft.revision)+' · '+(draft.released?'已发布':draft.previewed?'已预览，等待发布确认':'仅草稿，尚未进入我的看板')+'</span></div><div><button type=\"button\" data-preview-draft=\"'+escapeHtml(draft.assetId)+'\" data-draft-revision=\"'+escapeHtml(draft.revision)+'\" '+(draft.released?'disabled':'')+'>预览草稿</button><button type=\"button\" class=\"publish-draft\" data-release-draft=\"'+escapeHtml(draft.assetId)+'\" data-draft-revision=\"'+escapeHtml(draft.revision)+'\" '+(!draft.previewed||draft.released?'disabled':'')+'>'+ (draft.released?'已发布到我的看板':'确认发布')+'</button></div></section>'}if(s.error)html+='<p class=\"agent-block agent-error\">'+escapeHtml(s.error)+'</p>';",
    )
    .replace(
      "document.getElementById('open-session')?.addEventListener('click',()=>{if(state.sessionId)window.parent.postMessage({source:'dsh-workbench',kind:'open-session',requestId:state.requestId,sessionId:state.sessionId},location.origin)})",
      "document.querySelectorAll('[data-preview-draft]').forEach(button=>button.addEventListener('click',async()=>{const assetId=button.dataset.previewDraft,revision=button.dataset.draftRevision;if(!assetId||!revision)return;const preview=window.open('about:blank','_blank');button.disabled=true;try{const response=await fetch(dashboardAgentApi()+'/dashboard-drafts/'+encodeURIComponent(assetId)+'/'+encodeURIComponent(revision)+'/preview',{method:'POST',headers:{'content-type':'application/json'}}),payload=await response.json();if(!response.ok)throw new Error(payload.error||'无法打开预览');if(state.stream?.dashboardDraft)state.stream.dashboardDraft.previewed=true;state.activity='已打开预览，请确认后再发布';if(preview)preview.location.assign(payload.previewUrl);else location.assign(payload.previewUrl);refreshStream()}catch(error){preview?.close();state.activity=error instanceof Error?error.message:'无法打开预览';refreshStream()}finally{button.disabled=false}}));document.querySelectorAll('[data-release-draft]').forEach(button=>button.addEventListener('click',async()=>{const assetId=button.dataset.releaseDraft,revision=button.dataset.draftRevision;if(!assetId||!revision||!state.stream?.dashboardDraft?.previewed)return;if(!window.confirm('确认将当前预览版本发布到“我的看板”吗？'))return;button.disabled=true;try{const response=await fetch(dashboardAgentApi()+'/dashboard-drafts/'+encodeURIComponent(assetId)+'/'+encodeURIComponent(revision)+'/release',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({confirmed:true})}),payload=await response.json();if(!response.ok)throw new Error(payload.error||'发布失败');state.stream.dashboardDraft.released=true;state.activity='已发布到我的看板';refreshStream()}catch(error){state.activity=error instanceof Error?error.message:'发布失败';refreshStream()}finally{button.disabled=false}}));document.getElementById('open-session')?.addEventListener('click',()=>{if(state.sessionId)window.parent.postMessage({source:'dsh-workbench',kind:'open-session',requestId:state.requestId,sessionId:state.sessionId},location.origin)})",
    )
    .replace(
      'body:JSON.stringify({prompt}),signal:state.abortController.signal',
      'body:JSON.stringify({prompt,uploadId:state.dashboardAgentUploadId,clientRenderVersion:2}),signal:state.abortController.signal',
    )
    .replace(
      "function refreshStream(){if(state.sessionId)persistActiveHistory();render();if(state.followOutput!==false)requestAnimationFrame(()=>window.scrollTo({top:document.documentElement.scrollHeight,behavior:'smooth'}))}",
      "function nearLatest(){return content.scrollHeight-content.scrollTop-content.clientHeight<96}function latestButton(){let button=document.getElementById('jump-to-latest');if(button)return button;button=document.createElement('button');button.id='jump-to-latest';button.className='jump-to-latest';button.type='button';button.setAttribute('aria-label','跳转到最新消息');button.setAttribute('data-tooltip','跳转到最新消息');button.innerHTML=icons.chevronDown;button.hidden=true;button.addEventListener('click',()=>{state.followOutput=true;content.scrollTo({top:content.scrollHeight,behavior:'smooth'});syncLatestButton()});content.append(button);return button}function placeLatestButton(button){const composer=document.querySelector('.composer-wrapper.chat-composer');if(!composer)return;const rect=composer.getBoundingClientRect();button.style.left=Math.round(rect.left+rect.width/2)+'px';button.style.bottom=Math.max(12,Math.round(innerHeight-rect.top+12))+'px'}function syncLatestButton(){const button=latestButton();placeLatestButton(button);button.hidden=state.followOutput!==false||!state.sending}function refreshStream(){if(state.streamRenderPending)return;const scroller=content,shouldFollow=state.followOutput!==false&&nearLatest();state.streamRenderPending=true;requestAnimationFrame(()=>{state.streamRenderPending=false;if(state.sessionId)persistActiveHistory();render();state.followOutput=shouldFollow;if(shouldFollow)requestAnimationFrame(()=>{content.scrollTop=content.scrollHeight;syncLatestButton()});else syncLatestButton()})}",
    )
    .replace(
      'button.innerHTML=icons.chevronDown;',
      "button.innerHTML='<img src=\"'+(location.pathname.startsWith('/dsh-workbench')?'/dsh-workbench':'')+'/'+'assets/jump-to-latest-chevron.png\" alt=\"\" aria-hidden=\"true\" style=\"display:block;width:28px;height:28px;object-fit:contain\">';",
    )
    .replace(
      "if(!state.scrollBound){state.scrollBound=true;window.addEventListener('scroll',()=>{state.followOutput=window.innerHeight+window.scrollY>=document.documentElement.scrollHeight-72},{passive:true})};",
      "if(!state.scrollBound){state.scrollBound=true;content.addEventListener('scroll',()=>{state.followOutput=nearLatest();syncLatestButton()},{passive:true})};",
    )
    .replace(
      "prompt?.addEventListener('input',event=>{state.draft=event.target.value;updateSend()});",
      "prompt?.addEventListener('input',event=>{state.draft=event.target.value;updateSend()});prompt?.addEventListener('keydown',event=>{if(event.key!=='Enter'||event.shiftKey||event.isComposing||event.keyCode===229)return;const send=document.getElementById('send-button');if(!send||send.disabled)return;event.preventDefault();send.click()});",
    )
    .replace(
      "document.getElementById('upload-button')?.addEventListener('click',()=>{state.attachOpen=!state.attachOpen;closeSearch();render()})",
      "document.getElementById('upload-button')?.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();state.attachOpen=event.currentTarget.getAttribute('aria-expanded')!=='true';closeSearch();render()})",
    )
    .replace(
      "document.getElementById('upload-button')?.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();state.attachOpen=event.currentTarget.getAttribute('aria-expanded')!=='true';closeSearch();render()})",
      "document.getElementById('upload-button')?.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();state.attachOpen=event.currentTarget.getAttribute('aria-expanded')!=='true';closeSearch();render()});if(!state.attachDismissBound){state.attachDismissBound=true;document.addEventListener('click',event=>{if(!state.attachOpen)return;const target=event.target;if(target instanceof Element&&target.closest('#attachment-popover,#upload-button'))return;state.attachOpen=false;render()})}",
    )
    .replace(
      "state.stream={live:true,question:state.stream?.question||'已恢复看板搭建任务',name:true,planText:",
      "state.stream={live:true,question:state.stream?.question||'已恢复看板搭建任务',attachmentName:state.stream?.attachmentName||'',name:true,planText:",
    )
    .replace('</body>', `${conversationMinimapScript()}</body>`)
}

function conversationMinimapScript(): string {
  return `<script>(()=>{const content=document.getElementById('page-content');if(!content)return;let minimap,frame=0;const rows=()=>{const thread=content.querySelector('.chat-thread');if(!thread)return[];const turns=[...thread.querySelectorAll('.conversation-turn')];return turns.length?turns:[...thread.querySelectorAll('.user-message,.agent-message,.agent-block')]};const mount=()=>{if(minimap)return minimap;minimap=document.createElement('nav');minimap.id='conversation-minimap';minimap.className='conversation-minimap';minimap.setAttribute('aria-label','对话内容导航');minimap.innerHTML='<div class="conversation-minimap-track"><div class="conversation-minimap-viewport" aria-hidden="true"></div></div>';document.body.append(minimap);return minimap};const schedule=()=>{if(frame)return;frame=requestAnimationFrame(()=>{frame=0;render()})};const render=()=>{const nav=mount(),items=rows(),rect=content.getBoundingClientRect(),range=content.scrollHeight-content.clientHeight;const visible=items.length>0&&range>48&&innerWidth>760;nav.hidden=!visible;if(!visible)return;nav.style.setProperty('--conversation-minimap-left',Math.round(rect.left+12)+'px');nav.style.setProperty('--conversation-minimap-top',Math.round(rect.top+76)+'px');nav.style.setProperty('--conversation-minimap-height',Math.max(152,Math.min(440,Math.round(rect.height-152)))+'px');const track=nav.querySelector('.conversation-minimap-track'),viewport=nav.querySelector('.conversation-minimap-viewport');track.querySelectorAll('.conversation-minimap-marker').forEach(marker=>marker.remove());const total=Math.max(content.scrollHeight,1),viewTop=content.scrollTop,viewBottom=viewTop+content.clientHeight;for(const [index,item] of items.entries()){const itemRect=item.getBoundingClientRect(),start=itemRect.top-rect.top+content.scrollTop,end=start+itemRect.height,marker=document.createElement('button');marker.type='button';marker.className='conversation-minimap-marker'+(end>viewTop&&start<viewBottom?' is-current':'');marker.style.top=(Math.max(0,start)/total*100)+'%';marker.style.height=Math.max(3,Math.min(24,itemRect.height/total*100))+'%';marker.setAttribute('aria-label','跳转到第'+(index+1)+'段对话');marker.addEventListener('click',()=>content.scrollTo({top:Math.max(0,start-28),behavior:'smooth'}));track.append(marker)}viewport.style.top=(viewTop/total*100)+'%';viewport.style.height=Math.max(7,content.clientHeight/total*100)+'%'};content.addEventListener('scroll',schedule,{passive:true});new MutationObserver(schedule).observe(content,{childList:true,subtree:true,characterData:true});new ResizeObserver(schedule).observe(content);addEventListener('resize',schedule,{passive:true});schedule()})()</script>`
}

export function conversationHandoffStyles(): string {
  return `html,body{height:100%;overflow:hidden}.workbench{height:100dvh;min-height:0;overflow:hidden}.sidebar{height:100%;min-height:0;overflow-y:auto;overscroll-behavior:contain}.content{height:100%;min-height:0;overflow-y:auto;overscroll-behavior:contain;scroll-behavior:auto}.sidebar,.content,.sidebar-history{scrollbar-width:thin;scrollbar-color:#d4d4d4 transparent}.sidebar::-webkit-scrollbar,.content::-webkit-scrollbar,.sidebar-history::-webkit-scrollbar{width:8px;height:8px}.sidebar::-webkit-scrollbar-track,.content::-webkit-scrollbar-track,.sidebar-history::-webkit-scrollbar-track{background:transparent}.sidebar::-webkit-scrollbar-thumb,.content::-webkit-scrollbar-thumb,.sidebar-history::-webkit-scrollbar-thumb{min-height:32px;border:2px solid transparent;border-radius:999px;background:#d4d4d4;background-clip:content-box}.sidebar::-webkit-scrollbar-thumb:hover,.content::-webkit-scrollbar-thumb:hover,.sidebar-history::-webkit-scrollbar-thumb:hover{background-color:#c7c7c7}.sidebar::-webkit-scrollbar-button,.content::-webkit-scrollbar-button,.sidebar-history::-webkit-scrollbar-button{display:none}.new-page{height:auto;min-height:100%;box-sizing:border-box}.chat-layout{min-height:100%;box-sizing:border-box;padding-bottom:176px}.chat-thread{padding-bottom:0}.conversation-turn{display:grid;gap:18px}.conversation-turn+.conversation-turn{margin-top:18px}.chat-thread .user-message{justify-self:end;margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:10px;padding:0;background:transparent;color:#171717;font-weight:650}.user-message-text{display:block;padding:12px 16px;border-radius:18px;background:#f1f1f1;color:#171717;font-weight:650}.sent-attachment{display:inline-flex;align-items:center;gap:7px;max-width:100%;padding:0;border:0;border-radius:0;background:transparent;color:#171717;font-size:12px;font-weight:600;line-height:1.2;box-shadow:none}.sent-attachment svg{width:15px;height:15px;flex:none}.sent-attachment strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dashboard-draft-actions{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:14px;padding:14px 16px;border:1px solid #d9d8d4;border-radius:12px;background:#fafaf8}.dashboard-draft-actions>div:first-child{display:grid;gap:3px;min-width:0}.dashboard-draft-actions strong{font-size:14px}.dashboard-draft-actions span{color:#737373;font-size:12px}.dashboard-draft-actions>div:last-child{display:flex;gap:8px;flex:none}.dashboard-draft-actions button{height:32px;padding:0 11px;border:1px solid #cfcfca;border-radius:7px;background:#fff;color:#252525;font-size:12px;font-weight:600}.dashboard-draft-actions .publish-draft{border-color:#171717;background:#171717;color:#fff}.dashboard-draft-actions button:disabled{opacity:.45;cursor:not-allowed}.jump-to-latest{position:fixed;z-index:12;display:grid;place-items:center;width:36px;height:32px;padding:0;border:0;border-radius:8px;background:transparent;color:#292929;box-shadow:none;transform:translateX(-50%);cursor:pointer}.jump-to-latest svg{width:28px;height:28px;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}.jump-to-latest:hover{background:#f5f5f5}.jump-to-latest:focus-visible{outline:2px solid #171717;outline-offset:2px}.conversation-minimap{position:fixed;z-index:20;left:var(--conversation-minimap-left);top:var(--conversation-minimap-top);width:38px;height:var(--conversation-minimap-height);padding:8px 7px;border:1px solid rgb(0 0 0 / 6%);border-radius:8px;background:rgb(255 255 255 / 82%);box-shadow:0 5px 18px rgb(0 0 0 / 5%);backdrop-filter:blur(8px);box-sizing:border-box}.conversation-minimap[hidden]{display:none}.conversation-minimap-track{position:relative;width:100%;height:100%}.conversation-minimap-marker{position:absolute;left:0;width:100%;min-height:3px;padding:0;border:0;border-radius:2px;background:#c6c6c6;cursor:pointer}.conversation-minimap-marker:hover,.conversation-minimap-marker:focus-visible{background:#858585;outline:0}.conversation-minimap-marker.is-current{background:#555}.conversation-minimap-viewport{position:absolute;z-index:2;left:-3px;right:-3px;min-height:7px;border:1.5px solid #222;border-radius:3px;pointer-events:none;box-sizing:border-box}@media(max-width:760px){.workbench.host-embedded .sidebar{flex-basis:64px}.workbench.host-embedded .content{min-width:0;overflow-x:hidden}.sidebar-history{display:none}.chat-layout{padding-bottom:154px}.dashboard-draft-actions{align-items:flex-start;flex-direction:column}.jump-to-latest{width:34px;height:30px}.jump-to-latest svg{width:26px;height:26px}.conversation-minimap{display:none}}`
}
