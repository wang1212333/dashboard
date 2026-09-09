import { expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { nativeWorkbenchTheme } from '../src/native-surface-theme.js'

it('keeps visual adaptation scoped and restores the workbench text density', () => {
  expect(nativeWorkbenchTheme).toContain('.native-content p,.native-content li,.native-content table{font-size:14px;line-height:1.65')
  expect(nativeWorkbenchTheme).toContain('border-radius:14px;background:#f4f4f4')
  expect(nativeWorkbenchTheme).toContain('_toBottomSlot"]{justify-content:center')
  expect(nativeWorkbenchTheme).not.toMatch(/(^|\n)(body|html|:root)[{\s]/)
})
it('uses one document stacking context and removes popover-specific cutouts', async () => {
  const client = await readFile(new URL('../src/client.ts', import.meta.url), 'utf8')
  const surface = await readFile(new URL('../src/native-surface-theme.ts', import.meta.url), 'utf8')
  expect(client).toContain('createNativeSurfacePanel(document, doc!)')
  expect(client).not.toContain('clipPath')
  expect(surface).toContain("panel.attachShadow({ mode: 'open' })")
  expect(surface).toContain('destination.body.append(panel)')
  expect(surface).not.toContain('innerHTML')
})
