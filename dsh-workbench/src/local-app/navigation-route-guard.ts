/** Keep browser state in sync when moving away from the board library. */
export function navigationRouteGuardBehavior(): string {
  return String.raw`(()=>{
    const notify=()=>{if(parent!==window)parent.postMessage({source:'dsh-workbench',kind:'workbench-route',route:location.pathname+location.search},location.origin)};
    for(const method of ['pushState','replaceState']){const original=history[method].bind(history);history[method]=function(...args){original(...args);queueMicrotask(notify)}}
    document.addEventListener('click',event=>{const item=event.target instanceof Element?event.target.closest('.nav-item[data-page]'):null;if(!item)return;const page=item.dataset.page;if(page==='boards'||!page)return;const url=new URL(location.href);for(const key of ['page','section','status','scope','query','view','dashboard','viewer','nativeSession'])url.searchParams.delete(key);url.searchParams.set('section',page);history.replaceState({},'',url)},true);
    window.addEventListener('message',event=>{const data=event.data;if(event.source!==parent||event.origin!==location.origin||data?.source!=='dsh-workbench'||!['native-session-bound','native-session-restored','native-session-started'].includes(data.kind)||!data.sessionId)return;const url=new URL(location.href);url.searchParams.set('nativeSession',data.sessionId);url.searchParams.delete('section');url.searchParams.delete('page');history.replaceState({},'',url)});
    const section=new URL(location.href).searchParams.get('section');
    if(['library','subscriptions'].includes(section))queueMicrotask(()=>document.querySelector('.nav-item[data-page="'+section+'"]')?.click());
    window.addEventListener('popstate',notify);notify();
  })()`
}
