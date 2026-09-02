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
      'const dashboardAgentApi=()=>location.pathname.startsWith(\'/dsh-workbench\')?\'/api/dsh-workbench\':\'/api\';\n  function applyHeadlessAgentEvent(event){',
      "const dashboardAgentApi=()=>location.pathname.startsWith('/dsh-workbench')?'/api/dsh-workbench':'/api';\n  function ensureConversationHistory(){const sessionId=state.dashboardAgentSessionId||state.sessionId;if(!sessionId)return;state.sessionId=sessionId;const current=state.history.find(item=>item.sessionId===sessionId);const title=current?.title||'生成看板：'+(state.stream?.attachmentName||state.stream?.question?.slice(0,24)||'数据看板');const record={sessionId,title,createdAt:current?.createdAt||Date.now(),timeline:state.timeline,activity:state.activity,runState:state.runState||'running',stream:state.stream,streamState:state.streamState,turns:state.conversationTurns,dashboardAgentSessionId:sessionId,dashboardAgentUploadId:state.dashboardAgentUploadId};state.history=[record,...state.history.filter(item=>item.sessionId!==sessionId)];saveHistory(state.history);renderHistory()}\n  function applyHeadlessAgentEvent(event){",
    )
    .replace(
      'state.dashboardAgentSessionId=created.sessionId;',
      'state.dashboardAgentSessionId=created.sessionId;state.sessionId=created.sessionId;ensureConversationHistory();',
    )
    .replace(
      "function refreshStream(){if(state.sessionId)persistActiveHistory();render();if(state.followOutput!==false)requestAnimationFrame(()=>window.scrollTo({top:document.documentElement.scrollHeight,behavior:'smooth'}))}",
      "function nearLatest(){return content.scrollHeight-content.scrollTop-content.clientHeight<96}function latestButton(){let button=document.getElementById('jump-to-latest');if(button)return button;button=document.createElement('button');button.id='jump-to-latest';button.className='jump-to-latest';button.type='button';button.textContent='查看最新内容';button.hidden=true;button.addEventListener('click',()=>{state.followOutput=true;content.scrollTo({top:content.scrollHeight,behavior:'smooth'});syncLatestButton()});content.append(button);return button}function syncLatestButton(){const button=latestButton();button.hidden=state.followOutput!==false||!state.sending}function refreshStream(){if(state.streamRenderPending)return;const scroller=content,shouldFollow=state.followOutput!==false&&nearLatest();state.streamRenderPending=true;requestAnimationFrame(()=>{state.streamRenderPending=false;if(state.sessionId)persistActiveHistory();render();state.followOutput=shouldFollow;if(shouldFollow)requestAnimationFrame(()=>{content.scrollTop=content.scrollHeight;syncLatestButton()});else syncLatestButton()})}",
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
      "state.stream={live:true,question:state.stream?.question||'已恢复看板搭建任务',name:true,planText:",
      "state.stream={live:true,question:state.stream?.question||'已恢复看板搭建任务',attachmentName:state.stream?.attachmentName||'',name:true,planText:",
    )
}

export function conversationHandoffStyles(): string {
  return `html,body{height:100%;overflow:hidden}.workbench{height:100dvh;min-height:0;overflow:hidden}.sidebar{height:100%;min-height:0;overflow-y:auto;overscroll-behavior:contain}.content{height:100%;min-height:0;overflow-y:auto;overscroll-behavior:contain;scroll-behavior:auto}.sidebar,.content,.sidebar-history{scrollbar-width:thin;scrollbar-color:#d4d4d4 transparent}.sidebar::-webkit-scrollbar,.content::-webkit-scrollbar,.sidebar-history::-webkit-scrollbar{width:8px;height:8px}.sidebar::-webkit-scrollbar-track,.content::-webkit-scrollbar-track,.sidebar-history::-webkit-scrollbar-track{background:transparent}.sidebar::-webkit-scrollbar-thumb,.content::-webkit-scrollbar-thumb,.sidebar-history::-webkit-scrollbar-thumb{min-height:32px;border:2px solid transparent;border-radius:999px;background:#d4d4d4;background-clip:content-box}.sidebar::-webkit-scrollbar-thumb:hover,.content::-webkit-scrollbar-thumb:hover,.sidebar-history::-webkit-scrollbar-thumb:hover{background-color:#c7c7c7}.sidebar::-webkit-scrollbar-button,.content::-webkit-scrollbar-button,.sidebar-history::-webkit-scrollbar-button{display:none}.new-page{height:auto;min-height:100%;box-sizing:border-box}.chat-layout{min-height:100%;box-sizing:border-box;padding-bottom:176px}.chat-thread{padding-bottom:0}.conversation-turn{display:grid;gap:18px}.conversation-turn+.conversation-turn{margin-top:18px}.chat-thread .user-message{justify-self:end;margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:10px;padding:0;background:transparent;color:#171717;font-weight:650}.user-message-text{display:block;padding:12px 16px;border-radius:18px;background:#f1f1f1;color:#171717;font-weight:650}.sent-attachment{display:inline-flex;align-items:center;gap:7px;max-width:100%;padding:0;border:0;border-radius:0;background:transparent;color:#171717;font-size:12px;font-weight:600;line-height:1.2;box-shadow:none}.sent-attachment svg{width:15px;height:15px;flex:none}.sent-attachment strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.jump-to-latest{position:absolute;z-index:12;left:50%;bottom:126px;display:inline-flex;align-items:center;height:36px;padding:0 14px;border:1px solid #dadada;border-radius:18px;background:#fff;color:#252525;font-size:13px;font-weight:600;box-shadow:0 6px 18px rgb(0 0 0 / 12%);transform:translateX(-50%)}.jump-to-latest:hover{background:#f5f5f5}.jump-to-latest:focus-visible{outline:2px solid #171717;outline-offset:2px}@media(max-width:760px){.workbench.host-embedded .sidebar{flex-basis:64px}.workbench.host-embedded .content{min-width:0;overflow-x:hidden}.workbench.host-embedded .sidebar-history{display:none}.chat-layout{padding-bottom:154px}.jump-to-latest{bottom:108px}}`
}
