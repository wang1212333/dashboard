import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { buildDashboardFromCsv } from './build.js'
import type { DashboardSpec } from '../dashboard-agent/contracts.js'

const [inputPath, outputPath, ...flags] = process.argv.slice(2)
const option = (name: string) => {
  const index = flags.indexOf(name)
  return index >= 0 ? flags[index + 1] : undefined
}
if (!inputPath || !outputPath) {
  console.error('Usage: pnpm dashboard:run -- <input.csv> <output.html> [--asset-id id] [--template content-ops-v1] [--title title] [--spec dashboard-spec.json]')
  process.exitCode = 2
} else {
  const input = resolve(inputPath)
  const target = resolve(outputPath)
  const specPath = option('--spec')
  const spec = specPath ? JSON.parse(await readFile(resolve(specPath), 'utf8')) as DashboardSpec : undefined
  const result = buildDashboardFromCsv(await readFile(input, 'utf8'), {
    assetId: option('--asset-id') ?? 'content-ops-dashboard',
    templateId: spec?.templateId ?? option('--template'),
    mapping: spec?.mapping,
    spec,
    displayName: option('--title') ?? spec?.title,
    sourceLabel: option('--source-label'),
  })
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, result.html, 'utf8')
  console.log(JSON.stringify({ output: target, validRows: result.quality.validRows, rejectedRows: result.quality.rejectedRows.length, timeframe: 'timeframe' in result.model ? result.model.timeframe : undefined, note: 'For versioned artifacts and quality reports, use library:run.' }, null, 2))
}
