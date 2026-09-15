import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'
import { renderLocalWorkbenchPage } from '../src/local-app/page.js'

it('keeps the background session indicator until its own completion and rejects foreign updates', () => {
  const page = renderLocalWorkbenchPage()
  const start = page.indexOf('const historyRunning=new Map();')
  const end = page.indexOf('function historyToast', start)
  const rows = ['running', 'other'].map(id => ({ dataset: { sessionId: id }, indicator: null as null | { remove(): void },
    querySelector() { return this.indicator },
    insertAdjacentHTML(_position: string, html: string) { expect(html).toContain('正在分析'); this.indicator = { remove: () => { this.indicator = null } } },
  }))
  let listener: (event: unknown) => void = () => {}
  const parent = {}
  runInNewContext(page.slice(start, end), { Map, document: { querySelectorAll: () => rows }, window: { parent, addEventListener: (_: string, fn: typeof listener) => { listener = fn } }, location: { origin: 'http://localhost' } })
  const update = (id: string, running: boolean, origin = 'http://localhost') => listener({ source: parent, origin, data: { source: 'dsh-workbench', kind: 'history-running-state', sessionId: id, running } })
  update('running', true)
  update('other', false)
  expect(rows[0].indicator).not.toBeNull()
  expect(rows[1].indicator).toBeNull()
  update('running', false, 'http://foreign')
  expect(rows[0].indicator).not.toBeNull()
  update('running', false)
  expect(rows[0].indicator).toBeNull()
})
