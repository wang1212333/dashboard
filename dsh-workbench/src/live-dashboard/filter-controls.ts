/** Runtime-owned, dataset-configured controls; no native form submission (sandbox compatible). */
export function filterControls():string{return String.raw`
 let appliedFilters,filterForm,applyButton,optionLoads=0;const filterStates=new Map();
 const selectedValues=()=>Object.fromEntries([...filterStates].map(([id,s])=>[id,s.read()]));
 function setupFilters(data){
  if(filterForm||!data.spec.interactiveFilters?.length)return;
  appliedFilters=data.appliedFilters;
  const host=document.createElement('div'),mount=document.getElementById('dsh-live-filters');if(mount)mount.append(host);else status.parentNode.insertBefore(host,status);
  const root=host.attachShadow({mode:'open'});
  root.innerHTML='<style>:host{display:block;margin:18px 0;font:var(--dsh-filter-font,14px system-ui);color:var(--dsh-filter-text,inherit)}*{box-sizing:border-box}form{display:flex;flex-wrap:wrap;gap:12px;align-items:start}.field{display:grid;gap:6px;min-width:170px;max-width:100%;flex:1 1 190px;position:relative}input,select,button,summary{max-width:100%;min-width:0;font:inherit;padding:8px 10px;border:1px solid var(--dsh-filter-border,#d5d3ce);border-radius:var(--dsh-filter-radius,8px);background:var(--dsh-filter-bg,transparent);color:inherit;min-height:var(--dsh-filter-height,38px)}button,summary{cursor:pointer}button{white-space:nowrap;flex-shrink:0}button:disabled{opacity:.5;cursor:wait}button:hover,summary:hover{background:var(--dsh-filter-hover,#eae8e3)}:focus-visible{outline:2px solid var(--dsh-filter-focus,#8b877e);outline-offset:2px}select{width:100%}.actions{display:flex;gap:8px;flex:1 0 100%;margin-top:4px}.actions button:first-child{background:var(--dsh-filter-accent,#262522);color:var(--dsh-filter-on-accent,#fff);border-color:transparent}small,p{font-size:12px;color:var(--dsh-filter-muted,inherit);opacity:.75;margin:4px 0}small:empty{display:none}.search{display:flex;gap:6px}.search input{width:100%;flex:1}.range{display:flex;align-items:center;gap:6px}.range input{width:0;flex:1}.field:has(.range){flex-basis:300px}summary{list-style:none;display:flex;justify-content:space-between;gap:8px}summary::-webkit-details-marker{display:none}summary:after{content:"⌄";flex:none}summary span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.panel{position:absolute;top:100%;left:0;right:0;min-width:0;z-index:20;background:var(--dsh-filter-surface,#faf9f6);border:1px solid var(--dsh-filter-border,#d5d3ce);border-radius:var(--dsh-filter-radius,8px);padding:12px;box-shadow:0 6px 18px #00000012;display:grid;gap:8px}.choices{max-height:220px;overflow:auto}.choice{display:flex;align-items:center;gap:8px;padding:6px;border-radius:4px;overflow-wrap:anywhere}.choice:hover{background:var(--dsh-filter-hover,#eae8e3)}.choice input{width:16px;height:16px;min-height:0;padding:0;margin:0;accent-color:var(--dsh-filter-accent,#262522)}[hidden]{display:none!important}@media(max-width:480px){.field{flex-basis:100%;min-width:0}.panel{position:relative;top:auto}.range{flex-wrap:wrap}}</style><form aria-label="看板筛选"></form><p>修改后点击应用；自动刷新沿用已应用条件。</p>';
  filterForm=root.querySelector('form');
  function buttonFor(text,parent,fn){const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=fn;parent.append(b);return b}
  function inputFor(label,type,name){const input=document.createElement('input');input.type=type;input.setAttribute('aria-label',name);label.append(input);return input}
  const changed=async id=>{
   const descendants=new Set();const visit=id=>{for(const [k,s] of filterStates)if(s.f.dependsOn?.includes(id)&&!descendants.has(k)){descendants.add(k);visit(k)}};visit(id);
   for(const k of descendants){const s=filterStates.get(k);s.seq++;s.controller?.abort();s.set(null);if(s.search)s.search.value='';s.next=null;if(s.note)s.note.textContent='上级条件已改变，选择已清空'}
   for(const k of descendants)if(filterStates.get(k).load)await filterStates.get(k).load(false);
  };
  for(const f of data.spec.interactiveFilters){
   const label=document.createElement('div');label.className='field';label.append(document.createTextNode(f.label));filterForm.append(label);const s={f,seq:0};filterStates.set(f.id,s);
   if(f.type==='select'||f.type==='multiSelect'){
    const select=document.createElement('select');select.setAttribute('aria-label',f.label);select.multiple=f.type==='multiSelect';if(select.multiple)select.size=4;label.append(select);s.select=select;s.choices=f.options||[];
    const fill=(choices,values)=>{select.replaceChildren();if(!select.multiple)select.add(new Option('全部固定范围',''));for(const o of choices){const option=new Option(o.label,JSON.stringify(o.value));option.selected=values.some(v=>JSON.stringify(v)===option.value);select.add(option)}if(!select.multiple&&!values.length)select.value=''};
    s.read=()=>{const values=[...select.selectedOptions].filter(o=>o.value!=='').map(o=>JSON.parse(o.value));return select.multiple?(values.length?values:null):values[0]??null};
    s.set=v=>{const values=v==null?[]:Array.isArray(v)?v:[v];const choices=new Map(s.choices.map(o=>[JSON.stringify(o.value),o]));for(const value of values)if(!choices.has(JSON.stringify(value)))choices.set(JSON.stringify(value),{label:String(value),value});fill([...choices.values()],values)};
    const details=document.createElement('details'),summary=document.createElement('summary'),caption=document.createElement('span'),panel=document.createElement('div'),choicesView=document.createElement('div');panel.className='panel';choicesView.className='choices';summary.append(caption);summary.setAttribute('aria-label',f.label);details.append(summary,panel);label.append(details);select.hidden=true;panel.append(choicesView);
    const updateView=()=>{choicesView.replaceChildren();const chosen=[...select.selectedOptions].filter(o=>o.value!=='');caption.textContent=chosen.length>1?'已选 '+chosen.length+' 项':chosen[0]?.textContent||'全部';caption.title=chosen.map(o=>o.textContent).join('、');for(const option of select.options){if(option.value==='')continue;const row=document.createElement('label'),check=document.createElement('input');row.className='choice';check.type=select.multiple?'checkbox':'radio';check.name=f.id;check.checked=option.selected;row.append(check,document.createTextNode(option.textContent));check.onchange=()=>{if(!select.multiple)for(const o of select.options)o.selected=false;option.selected=check.checked;const index=[...select.options].filter(o=>o.value!=='').indexOf(option);updateView();choicesView.querySelectorAll('input')[index]?.focus();changed(f.id);if(!select.multiple){details.open=false;summary.focus()}};choicesView.append(row)}};
    const setOriginal=s.set;s.set=v=>{setOriginal(v);updateView()};
    details.addEventListener('toggle',()=>{if(details.open)for(const other of root.querySelectorAll('details'))if(other!==details)other.open=false});
    details.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();details.open=false;summary.focus()}if(e.key==='Enter')e.stopPropagation()});
    document.addEventListener('click',e=>{if(!e.composedPath().includes(host))details.open=false});
    buttonFor('清空选择',panel,()=>{s.set(null);changed(f.id)});
    if(f.dynamic){
     const searchBox=document.createElement('div');searchBox.className='search';panel.prepend(searchBox);s.search=inputFor(searchBox,'search',f.label+'搜索');s.search.placeholder='搜索授权选项';s.search.maxLength=100;
     buttonFor('搜索',searchBox,()=>s.load(false));s.more=buttonFor('加载更多',panel,()=>s.load(true));s.more.hidden=true;s.note=document.createElement('small');panel.append(s.note);
     s.load=async more=>{
      if(s.loadedSearch!==s.search.value)more=false;
      const seq=++s.seq;s.controller?.abort();s.controller=new AbortController();optionLoads++;if(applyButton)applyButton.disabled=true;s.note.textContent='正在查询选项…';s.more.disabled=true;
      try{
       const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({option:f.id,filters:selectedValues(),search:s.search.value,cursor:more?s.next||0:0}),signal:AbortSignal.any([s.controller.signal,AbortSignal.timeout(180000)]),cache:'no-store'});
       const result=await response.json();if(!response.ok)throw Error(result.error||'选项查询失败');if(seq!==s.seq)return;
       const values=s.read(),choices=new Map((more?s.choices:[]).map(o=>[JSON.stringify(o.value),o]));for(const o of result.options)choices.set(JSON.stringify(o.value),o);s.choices=[...choices.values()];s.set(values);s.loadedSearch=s.search.value;s.next=result.nextCursor;s.more.hidden=s.next==null;s.note.textContent=result.limitReached?'选项较多，请搜索缩小范围':s.next==null?'':'还有更多选项，可搜索或继续加载';
      }catch(error){if(seq===s.seq&&error.name!=='AbortError')s.note.textContent=error.message}
      finally{optionLoads--;if(seq===s.seq)s.more.disabled=false;if(applyButton)applyButton.disabled=busy||optionLoads>0}
     };
     s.search.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();s.load(false)}};
    }
    select.onchange=()=>changed(f.id);
   }else if(['dateRange','monthRange','numberRange'].includes(f.type)){
    const number=f.type==='numberRange',month=f.type==='monthRange',start=inputFor(label,number?'number':month?'month':'date',f.label+(number?'最小值':'开始日期')),end=inputFor(label,number?'number':month?'month':'date',f.label+(number?'最大值':'结束日期'));
    const range=document.createElement('div');range.className='range';range.append(start,document.createTextNode('—'),end);label.append(range);
    for(const input of [start,end]){if(f.min!==undefined)input.min=String(f.min);if(f.max!==undefined)input.max=String(f.max);if(number)input.step='any';input.onchange=()=>changed(f.id)}
    s.set=v=>{start.value=v?.[number?'min':'start']??'';end.value=v?.[number?'max':'end']??''};
    s.read=()=>{if(!start.value&&!end.value)return null;if(number)return{min:start.value===''?null:Number(start.value),max:end.value===''?null:Number(end.value)};if(!start.value||!end.value||start.value>end.value)throw Error('请补全有效范围：'+f.label);return{start:start.value,end:end.value}};
   }else if(f.type==='text'){
    const input=inputFor(label,'text',f.label);input.maxLength=200;input.placeholder=f.match==='equals'?'精确匹配':f.match==='startsWith'?'以此开头':'包含文本';s.read=()=>input.value||null;s.set=v=>input.value=v??'';input.onchange=()=>changed(f.id);
   }else{
    const select=document.createElement('select');select.setAttribute('aria-label',f.label);label.append(select);select.add(new Option('不限',''));for(const [title,value] of f.type==='boolean'?[['是','true'],['否','false']]:[['为空（NULL）','empty'],['非空（非NULL）','notEmpty']])select.add(new Option(title,value));s.read=()=>select.value===''?null:f.type==='boolean'?select.value==='true':select.value;s.set=v=>select.value=v==null?'':String(v);select.onchange=()=>changed(f.id);
   }
   s.set(appliedFilters?.[f.id]??null);
  }
  const actions=document.createElement('div');actions.className='actions';filterForm.append(actions);
  function applySelection(){if(busy||optionLoads)return;try{if(!filterForm.reportValidity())return;appliedFilters=selectedValues();refresh()}catch(error){status.textContent=error.message}}
  applyButton=buttonFor('应用筛选',actions,applySelection);
  buttonFor('恢复默认',actions,async()=>{if(busy||optionLoads)return;for(const s of filterStates.values())s.set(s.f.defaultValue??null);for(const s of filterStates.values())if(s.load){s.search.value='';await s.load(false)}applySelection()});
  filterForm.onsubmit=e=>e.preventDefault();filterForm.onkeydown=e=>{if(e.key==='Enter'&&e.target.tagName!=='BUTTON'&&e.target.tagName!=='SUMMARY'){e.preventDefault();applySelection()}};
  (async()=>{for(const s of filterStates.values())if(s.load)await s.load(false)})();
 }
`}
