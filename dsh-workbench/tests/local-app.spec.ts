import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startLocalWorkbenchApp, type RunningLocalWorkbenchApp } from '../src/local-app/server.js'
import { renderLocalWorkbenchPage } from '../src/local-app/page.js'

const csv = `date,category,planned,published,views,conversions,revenue
2026-08-24,种草内容,2,2,1000,50,1000
2026-08-25,教程内容,2,1,500,10,300`
const contentMapping = { date: 'date', category: 'category', planned: 'planned', published: 'published', views: 'views', conversions: 'conversions', revenue: 'revenue' }
const roots: string[] = []
const apps: RunningLocalWorkbenchApp[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function start(): Promise<RunningLocalWorkbenchApp> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-workbench-app-'))
  roots.push(root)
  const app = await startLocalWorkbenchApp({ libraryRoot: root, port: 0 })
  apps.push(app)
  return app
}

describe('local import app', () => {
  it('moves a submitted prompt and its attachment into the read-only conversation record', () => {
    const page = renderLocalWorkbenchPage()
    expect(page).toContain('sent-attachment')
    expect(page).toContain("attachmentName:attachmentName||''")
    expect(page).toContain("state.file=null;state.draft='';beginLiveStream(sentQuestion,selectedFile.name)")
    expect(page).toContain('csv:await selectedFile.text()')
    expect(page).toContain("title:'生成看板：'+selectedFile.name")
    expect(page).toContain('intent:sentQuestion')
    expect(page).not.toContain('intent:state.draft')
  })

  it('renders syntactically valid template-library behavior with an explicit selection endpoint', () => {
    const scripts = renderLocalWorkbenchPage().split('<script>').slice(1).map(part => part.split('</script>')[0])
    for (const script of scripts) expect(() => new Function(script)).not.toThrow()
    expect(scripts.join('\n')).toContain('/design-templates/selection')
    expect(scripts.join('\n')).not.toContain('window.fetch=')
  })

  it('uses one accessible compact tooltip for icon controls instead of native titles', () => {
    const page = renderLocalWorkbenchPage()
    expect(page).toContain("tip.setAttribute('role','tooltip')")
    expect(page).toContain('height:24px;padding:0 8px')
    expect(page).toContain('background:#171717')
    expect(page).toContain('showDelay=150,hideDelay=90')
    expect(page).toContain("element.setAttribute('aria-describedby',id)")
    expect(page).toContain("if(event.key==='Escape')close()")
    expect(page).toContain('data-tooltip="搜索"')
    expect(page).toContain('data-tooltip="添加附件"')
    expect(page).not.toContain('title="搜索"')
    expect(page).not.toContain("setAttribute('title'")
  })

  it('can start directly on the template-library page', () => {
    const page = renderLocalWorkbenchPage({ apiBase: '/api/dsh-workbench', initialPage: 'templates' })
    expect(page).toContain('function templatePage()')
    expect(page).toContain('class="nav-item template-nav-item" data-page="templates" data-template-library')
    expect(page).toContain("url.pathname=page==='templates'?'/dsh-workbench/templates':'/dsh-workbench'")
    expect(page).toContain("location.assign('/dsh-workbench?page='+encodeURIComponent(button.dataset.page||'new'))")
  })

  it('includes the interactive my-dashboards workspace with URL-first view preferences', () => {
    const page = renderLocalWorkbenchPage()
    expect(page).toContain('管理和访问你创建的全部看板。')
    expect(page).toContain('.my-dashboards .dash-tabs{border-bottom:1px solid var(--border)}')
    expect(page).toContain('.my-dashboards .dash-statuses{gap:8px}')
    expect(page).toContain('border-radius:18px;font-size:14px;font-weight:400')
    expect(page).toContain('border-color:transparent;background:#f2f2f2')
    expect(page).toContain("dsh.dashboard-workbench.view-mode")
    expect(page).toContain("['mine','shared','favorites']")
    expect(page).toContain('卡片视图')
    expect(page).toContain('列表视图')
    expect(page).toContain('删除看板？')
    expect(page).toContain('原始对话已不存在')
  })

  it('uses an icon-only, accessible collapsed sidebar for every navigation item', () => {
    const page = renderLocalWorkbenchPage()
    expect(page).toContain('.sidebar.collapsed .template-nav-item span{display:none}')
    expect(page).toContain('.nav-list{gap:2px}')
    expect(page).toContain('.sidebar.collapsed .nav-list{gap:2px;padding:8px}')
    expect(page).toContain('.sidebar.collapsed .nav-item,.sidebar.collapsed .template-nav-item{width:48px;height:48px;justify-content:center;padding:0;border-radius:12px}')
    expect(page).toContain('.sidebar.collapsed .brand-actions button:last-child{width:40px;height:40px;border:0;border-radius:10px;background:transparent}')
    expect(page).toContain('.sidebar.collapsed .brand-row:hover .brand-icon,.sidebar.collapsed .brand-row:focus-within .brand-icon{opacity:0}')
    expect(page).toContain('.sidebar.collapsed .brand-row:hover .brand-actions,.sidebar.collapsed .brand-row:focus-within .brand-actions{opacity:1;pointer-events:auto}')
    expect(page).toContain("closest('#collapse-button')")
    expect(page).toContain("collapsed?'展开侧栏':'收起侧栏'")
    expect(page).toContain("dsh-workbench:sidebar-collapsed")
    expect(page).toContain("applySidebarState(sessionStorage.getItem(sidebarStateKey)==='true')")
  })

  it('keeps the empty-state task launcher centered inside the content column', () => {
    const page = renderLocalWorkbenchPage()
    expect(page).toContain('task-launch-composer')
    expect(page).toContain('.task-launch{width:min(860px,100%);margin-inline:auto}')
    expect(page).toContain('.chat-empty{text-align:left}')
    expect(page).toContain('position:static;left:auto;right:auto;bottom:auto;width:100%;margin:56px 0 0')
    expect(page).toContain('.task-launch-composer .composer{height:150px}')
    expect(page).toContain('.task-launch-composer .prompt{height:94px}')
    expect(page).toContain('.task-launch-composer .composer-footer{height:56px;min-height:56px;align-items:center;gap:8px;padding:0 20px}')
    expect(page).toContain('.task-launch-composer .round-button{width:40px;height:40px;min-width:40px;padding:0;border:0;background:transparent')
    expect(page).toContain('.task-launch-composer .agent-select>button{height:36px;min-width:0;gap:8px;padding:0 12px;border:0;border-radius:18px;background:#f7f8fa')
    expect(page).toContain('.task-launch-composer .agent-menu{bottom:44px;padding:3px}.task-launch-composer .agent-menu button{height:30px;padding:0 12px;font-size:12px;line-height:1.2}')
    expect(page).toContain('.task-launch-composer .send-button:disabled{background:#f1f2f4;color:#aeb4bc;cursor:not-allowed}')
    expect(page).toContain('.task-launch-composer .agent-select>button svg:last-child{display:none!important}')
    expect(page).toContain('.hero-title-row{display:flex;align-items:center;justify-content:center;gap:12px;width:100%;min-width:0;white-space:nowrap}')
    expect(page).toContain('.hero-title-logo{display:block;flex:0 0 auto;width:55px;height:55px;object-fit:contain}')
    expect(page).toContain('.task-launch .chat-empty h1{font-size:28px}.task-launch .chat-empty p{margin-top:18px}')
    expect(page).toContain('.composer-wrapper.chat-composer.task-launch-composer{position:relative}')
    expect(page).toContain('.composer-wrapper.chat-composer:not(.task-launch-composer) .composer{height:150px}')
    expect(page).toContain('.composer-wrapper.chat-composer:not(.task-launch-composer) .send-button{width:40px;min-width:40px;height:40px;margin-left:auto;padding:0;border-radius:50%;font-size:0}')
    expect(page).toContain('.composer-wrapper.chat-composer:not(.task-launch-composer) .composer.has-file{height:130px}')
    expect(page).toContain('.composer-wrapper.chat-composer:not(.task-launch-composer) .composer-footer{height:48px;min-height:48px;padding:0 18px}')
    expect(page).toContain("button.innerHTML=stopIcon;button.setAttribute('aria-label','停止生成')")
    expect(page).toContain("button.classList.add('is-paused');button.innerHTML=playIcon")
    expect(page).toContain("function decorateHomeHero(){const title=content.querySelector('.task-launch .chat-empty h1')")
    expect(page).toContain("const decorate=()=>{const title=document.querySelector('#page-content .task-launch .chat-empty h1')")
    expect(page).toContain("new MutationObserver(decorate).observe(document.getElementById('page-content')||document.body")
    expect(page).toContain("logo.src=(location.pathname.startsWith('/dsh-workbench')?'/dsh-workbench':'')+'/'+'assets/data-agent-logo-black.png'")
    expect(page).toContain('.hero-particle-canvas{position:absolute;z-index:0;pointer-events:none')
    expect(page).toContain("matchMedia('(prefers-reduced-motion: reduce)')")
    expect(page).toContain('maxParticles=mobile?6:12')
    expect(page).toContain('requestAnimationFrame(tick)')
    expect(page).toContain("logo.removeAttribute('aria-hidden');logo.tabIndex=0")
    expect(page).toContain("logo.setAttribute('aria-label','播放 Data Agent 图标粒子效果')")
    expect(page).not.toContain('.task-launch .chat-empty h1::before')
    expect(page).toContain('aria-label="添加附件"')
    expect(page).toContain("attachOpen:false")
    expect(page).toContain("event.currentTarget.getAttribute('aria-expanded')!=='true'")
    expect(page).toContain('event.stopImmediatePropagation()')
    expect(page).toContain("agent:'通用数据智能体'")
    expect(page).toContain("state.sending?'停止':'发送'")
    expect(page).not.toContain('<button id="return-session"')
  })

  it('renders a contained WebGL particle mark behind the empty-state conversation controls', () => {
    const page = renderLocalWorkbenchPage()
    expect(page).toContain('.particle-mark{position:absolute;z-index:0;top:8px;right:-250px')
    expect(page).toContain('pointer-events:auto;cursor:crosshair;background:transparent')
    expect(page).not.toContain('.particle-mark::before,.particle-mark::after')
    expect(page).toContain('cursor:crosshair;background:transparent')
    expect(page).toContain('.task-launch>.chat-empty,.task-launch>.task-launch-composer{position:relative;z-index:1}')
    expect(page).toContain('<script type="importmap">{"imports":{"three":"/assets/three.module.js"}}</script>')
    expect(page).toContain("import * as THREE from 'three'")
    expect(page).toContain('particleCount=mobile?6000:12000')
    expect(page).toContain("new THREE.WebGLRenderer({antialias:true,alpha:true})")
    expect(page).toContain("color:'#E4BFFF'")
    expect(page).toContain('blending:THREE.AdditiveBlending,depthWrite:false')
    expect(page).toContain('geometry?.dispose();material?.dispose();renderer?.dispose()')
    expect(page).toContain("panel.addEventListener('pointerdown',scatter)")
    expect(page).toContain('velocities=new Float32Array(particleCount*3)')
    expect(page).toContain('velocities[i3]*=.88')
    expect(page).not.toContain('particle-ripple-canvas')
    expect(page).not.toContain('particle-ripple-highlight')
    expect(page).not.toContain('particle-burst-canvas')
  })

  it('serves an upload UI and returns final HTML after a confirmed plan', async () => {
    const app = await start()
    await expect((await fetch(app.url)).text()).resolves.toContain('从数据到正式看板，按受控流程完成搭建')
    const three = await fetch(`${app.url}/assets/three.module.js`)
    expect(three.headers.get('content-type')).toContain('text/javascript')
    await expect(three.text()).resolves.toContain('WebGLRenderer')
    const logo = await fetch(`${app.url}/assets/data-agent-logo-black.png`)
    expect(logo.status).toBe(200)
    expect(logo.headers.get('content-type')).toContain('image/png')
    expect((await logo.arrayBuffer()).byteLength).toBeGreaterThan(0)
    await expect((await fetch(app.url)).text()).resolves.toContain("url.pathname=page==='templates'?'/dsh-workbench/templates':'/dsh-workbench'")
    await expect((await fetch(app.url)).text()).resolves.toContain('模板库')
    await expect((await fetch(app.url)).text()).resolves.toContain('/design-templates/selection')
    const analysis = await fetch(`${app.url}/api/analyze`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ csv }) })
    await expect(analysis.json()).resolves.toMatchObject({ rowCount: 2, recommendations: expect.arrayContaining([expect.objectContaining({ templateId: 'content-ops-v1' })]) })
    const planResponse = await fetch(`${app.url}/api/dashboard-plans`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ csv, fileName: '运营数据.csv', businessGoal: '识别内容运营表现并安排优化行动', templateId: 'content-ops-v1', mapping: contentMapping }) })
    expect(planResponse.status).toBe(201)
    const planned = await planResponse.json() as { plan: { planId: string; status: string; metrics: Array<{ id: string }>; charts: Array<{ id: string }> } }
    expect(planned.plan.status).toBe('needs_confirmation')
    const draftResponse = await fetch(`${app.url}/api/dashboard-plans/${planned.plan.planId}/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assetId: 'my-content-dashboard', confirmation: { businessConfirmed: true, storylineConfirmed: true } }) })
    expect(draftResponse.status).toBe(201)
    const draft = await draftResponse.json() as { revision: { revision: string; stage: string }; quality: { validRows: number }; dashboardUrl: string }
    expect(draft).toMatchObject({ revision: { revision: 'rev-0001', stage: 'draft' }, quality: { validRows: 2 }, dashboardUrl: '/assets/my-content-dashboard/rev-0001/dashboard.html' })
    await expect((await fetch(`${app.url}/assets/my-content-dashboard/rev-0001/source.html`)).text()).resolves.toContain('内容运营看板')
    await expect((await fetch(`${app.url}${draft.dashboardUrl}`)).text()).resolves.toContain('内容运营看板')
    expect((await fetch(`${app.url}/api/preview`, { method: 'POST' })).status).toBe(404)
    expect((await fetch(`${app.url}/api/release`, { method: 'POST' })).status).toBe(404)
  })

  it('does not expose a direct raw Spec build endpoint', async () => {
    const app = await start()
    const response = await fetch(`${app.url}/api/drafts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ csv: 'date,category\n2026-08-24,内容', assetId: 'bad-upload', templateId: 'content-ops-v1', mapping: { date: 'date', category: 'category' } }) })
    expect(response.status).toBe(404)
  })

  it('accepts a CSV upload as a local Agent-readable file', async () => {
    const app = await start()
    const response = await fetch(`${app.url}/api/uploads`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ csv, fileName: '运营数据.csv' }) })
    expect(response.status).toBe(201)
  })

  it('streams a structured dashboard run to a reviewable plan instead of untracked HTML', async () => {
    const app = await start()
    const uploadResponse = await fetch(`${app.url}/api/uploads`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ csv, fileName: '区域经营数据.csv' }) })
    const upload = await uploadResponse.json() as { uploadId: string }
    const response = await fetch(`${app.url}/api/runs`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify({ uploadId: upload.uploadId, intent: '生成经营看板' }) })
    expect(response.status).toBe(200)
    const stream = await response.text()
    expect(stream).toContain('event: run.started')
    expect(stream).toContain('event: tool.started')
    expect(stream).toContain('event: tool.completed')
    expect(stream).toContain('event: plan.created')
    expect(stream).toContain('event: run.completed')
    expect(stream).not.toContain('event: artifact.created')
    expect(stream).toContain('needs_confirmation')
  })
})
