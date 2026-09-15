import { chromium } from 'playwright-core'
import type { LiveSpec } from './service.js'

/** Execute only in an isolated browser with all network requests denied. */
export async function validateLiveRendering(html: string, spec: LiveSpec): Promise<void> {
  const browser = await chromium.launch({ ...(process.env.DSH_BROWSER_EXECUTABLE ? { executablePath: process.env.DSH_BROWSER_EXECUTABLE } : process.platform === 'win32' ? { channel: 'chrome' } : {}), headless: true })
  const watchdog = setTimeout(() => void browser.close(), 20000)
  try {
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false })
    await context.route('**/*', route => route.abort())
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 10000 })
    const problems = await page.evaluate(async (config) => {
      const w = window as typeof window & { renderDSHLive?: (data: unknown) => unknown }
      if (typeof w.renderDSHLive !== 'function') return ['缺少实时渲染函数']
      const issues: string[] = []
      const metric = (value: number | null) => Object.fromEntries(config.metrics.map((_,i) => ['m'+i,value]))
      const sample = (ranking: unknown[], empty = false) => ({ spec: config, totals: [{ ...metric(empty ? null : 100), records: empty ? 0 : 2 }], ranking, trend: [], validated: true, queriedAt: '2026-01-01T00:00:00Z', durationMs: 1 })
      const render = async (data: any) => {
        if(config.queries){data.results=Object.fromEntries(config.queries.map(d=>[d.id,(d.groupBy?.length?data.ranking:[data.totals[0]]).map((r:any)=>({...Object.fromEntries(d.metrics.map((_,i)=>['m'+i,r.m0])),records:r.records??2,...Object.fromEntries((d.groupBy??[]).map((_,i)=>[i?'d'+i:'bucket',r.bucket]))}))]));Object.assign(data,data.results)}
        await w.renderDSHLive!(data)
      }
      await render(sample([{ bucket: 'A', ...metric(80) }, { bucket: 'B', ...metric(20) }]))
      const charts = [...document.querySelectorAll<SVGElement>('[id*="donut"] svg,svg[id*="donut"],[id*="pie"] svg')].map(el => ({ el, content: el.innerHTML }))
      await render(sample([], true))
      if (charts.some(({el,content}) => content.includes('<path') && el.innerHTML === content)) issues.push('空数据刷新仍保留旧环形图')
      await render(sample([{ bucket: 'A', ...metric(100) }, { bucket: 'B', ...metric(-20) }]))
      if ([...document.querySelectorAll('[style]')].some(el => /width\s*:\s*-\d/.test(el.getAttribute('style') || ''))) issues.push('负数产生负宽度条形')
      const legends = [...document.querySelectorAll('[id*="donut"],[id*="pie"]')].map(el=>el.textContent).join(' ')
      if ([...legends.matchAll(/([\d.]+)%/g)].some(m => Number(m[1]) > 100)) issues.push('环形图出现超过100%的占比')
      await render(sample([{ bucket: 'A" data-render-audit="injected', ...metric(100) }]))
      if (document.querySelector('[data-render-audit="injected"]')) issues.push('动态文本破坏HTML属性，请使用textContent或完整属性转义')
      await render(sample([{ bucket: 'A', ...metric(null) }]))
      return issues
    }, spec)
    if (errors.length || problems.length) throw Error('实时页面运行校验失败：'+[...errors,...problems].join('；'))
  } finally { clearTimeout(watchdog); await browser.close() }
}
