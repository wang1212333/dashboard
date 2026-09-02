/**
 * Keeps a submitted request immutable in the conversation while resetting the
 * composer for the next turn. The base shell is intentionally shared with the
 * DSH iframe host, so these replacements cover both its host and local paths.
 */
export function applyConversationHandoff(page: string): string {
  return page
    .replace(
      "'<div class=\"chat-thread\"><div class=\"user-message\">'+escapeHtml(state.stream.question)+'</div>'+agentAnswer()+'</div>'",
      "'<div class=\"chat-thread\"><div class=\"user-message\">'+(state.stream.attachmentName?'<span class=\"sent-attachment\">'+icons.document+'<strong>'+escapeHtml(state.stream.attachmentName)+'</strong></span>':'')+'<span class=\"user-message-text\">'+escapeHtml(state.stream.question)+'</span></div>'+agentAnswer()+'</div>'",
    )
    .replace(
      "function beginLiveStream(question){state.streamState='planning';state.sending=true;state.stream={live:true,question,name:true,planText:'',tools:[],findings:[],lists:[],artifacts:[]};refreshStream()}",
      "function beginLiveStream(question,attachmentName){state.streamState='planning';state.sending=true;state.stream={live:true,question,name:true,attachmentName:attachmentName||'',planText:'',tools:[],findings:[],lists:[],artifacts:[]};refreshStream()}",
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
      "document.getElementById('upload-button')?.addEventListener('click',()=>{state.attachOpen=!state.attachOpen;closeSearch();render()})",
      "document.getElementById('upload-button')?.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();state.attachOpen=event.currentTarget.getAttribute('aria-expanded')!=='true';closeSearch();render()})",
    )
    .replace(
      "state.stream={live:true,question:state.stream?.question||'已恢复看板搭建任务',name:true,planText:",
      "state.stream={live:true,question:state.stream?.question||'已恢复看板搭建任务',attachmentName:state.stream?.attachmentName||'',name:true,planText:",
    )
}

export function conversationHandoffStyles(): string {
  return `.chat-thread .user-message{display:flex;flex-direction:column;align-items:flex-end;gap:8px;padding:0;background:transparent}.user-message-text{display:block;padding:15px 20px;border-radius:14px;background:#f4f4f4;color:#171717}.sent-attachment{display:inline-flex;align-items:center;gap:7px;max-width:100%;padding:8px 10px;border:1px solid #e4e4e4;border-radius:9px;background:#fff;color:#303030;font-size:12px;font-weight:600;line-height:1.2;box-shadow:0 1px 2px rgba(0,0,0,.03)}.sent-attachment svg{width:15px;height:15px;flex:none}.sent-attachment strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`
}
