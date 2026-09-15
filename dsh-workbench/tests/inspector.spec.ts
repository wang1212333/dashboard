import { expect, it } from 'vitest'
import { runInNewContext } from 'node:vm'
import { sqlInspector } from '../src/live-dashboard/inspector.js'
import { withEmbeddedQueryBridge } from '../src/live-dashboard/preview-bridge.js'
import { bindLivePage, validateLiveScripts, livePageContract } from '../src/live-dashboard/page.js'
import { filterControls } from '../src/live-dashboard/filter-controls.js'

it('compiles compact filters and upgrades an existing runtime without duplicating charts',()=>{
 const original='<html><head></head><body><div id="dsh-live-status"></div><button id="dsh-live-refresh"></button><script>window.renderDSHLive=()=>{}</script></body></html>'
 const page=bindLivePage(original,'test')
 const updated=withEmbeddedQueryBridge(page,'test')
 expect(()=>validateLiveScripts(updated)).not.toThrow()
 expect(updated.match(/function setupFilters\(data\)/g)).toHaveLength(1)
 expect(updated).toContain('window.renderDSHLive=()=>{}')
 expect(filterControls()).toContain("select.hidden=true")
 expect(filterControls()).toContain("check.type=select.multiple?'checkbox':'radio'")
 expect(filterControls()).toContain('--dsh-filter-surface')
 expect(livePageContract).toContain('--dsh-filter-surface')
})

it('invokes the embedded initializer rather than only declaring it',()=>{
 const script=sqlInspector().replace(/^<script[^>]*>/,'').replace(/<\/script>$/,'')
 let initialized=false
 expect(()=>runInNewContext(script,{document:{createElement(){initialized=true;throw Error('initialized')}}})).toThrow('initialized')
 expect(initialized).toBe(true)
})
it('refreshes only the marked inspector in existing revisions',()=>{
 const html='<html><head></head><body><main>original chart</main><script data-dsh-sql-inspector>old()</script><script>chart()</script></body></html>'
 const updated=withEmbeddedQueryBridge(html,'binding')
 expect(updated).not.toContain('old()')
 expect(updated).toContain('<main>original chart</main>')
 expect(updated).toContain('<script>chart()</script>')
 expect(updated.match(/data-dsh-sql-inspector/g)).toHaveLength(1)
})
