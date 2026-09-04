/** Keep browser state in sync when moving away from the board library. */
export function navigationRouteGuardBehavior(): string {
  return String.raw`(()=>{document.addEventListener('click',event=>{const item=event.target instanceof Element?event.target.closest('.nav-item[data-page]'):null;if(!item)return;const page=item.dataset.page;if(page==='boards'||!page)return;const url=new URL(location.href);if(url.searchParams.get('page')!=='boards')return;url.searchParams.set('page',page);history.replaceState({},'',url)},true)})()`
}
