import { resolve } from 'node:path'
import { DesignTemplateLibrary } from './design-template-library.js'
import { TemplateCoverLibrary } from './template-cover-library.js'

const args = process.argv.slice(2)
const rootIndex = args.indexOf('--root')
const root = resolve(rootIndex >= 0 && args[rootIndex + 1] ? args[rootIndex + 1] : './dsh-workbench-library')
const requested = args.filter(arg => !arg.startsWith('--') && arg !== (rootIndex >= 0 ? args[rootIndex + 1] : undefined))

const templates = new DesignTemplateLibrary({ cacheRoot: root })
const covers = new TemplateCoverLibrary({ cacheRoot: root })
const catalog = await templates.list()
const selected = requested.length ? catalog.filter(template => requested.includes(template.id)) : catalog
if (!selected.length) throw new Error('TEMPLATE_COVER_BUILD_NOTHING_SELECTED')

for (const template of selected) {
  const result = await covers.build(await templates.get(template.id))
  process.stdout.write(`${template.id}: ${result.cacheHit ? 'cached' : result.manifest.status}\n`)
  if (result.manifest.status === 'failed') process.exitCode = 1
}
