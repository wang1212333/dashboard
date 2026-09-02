import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { FilesystemKnowledgeLibrary } from './filesystem-library.js'

const [command, ...args] = process.argv.slice(2)
const option = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined }
const libraryRoot = option('--library')
const assetId = option('--asset-id')
const revision = option('--revision')
if (!command || !libraryRoot || !assetId) {
  console.error('Usage: pnpm library:run -- <build|inspect> --library <path> --asset-id <id> [--input file.csv]')
  process.exitCode = 2
} else {
  const library = new FilesystemKnowledgeLibrary(resolve(libraryRoot))
  if (command === 'build') {
    const input = option('--input')
    if (!input) throw new Error('INPUT_REQUIRED')
    const result = await library.buildDraft(await readFile(resolve(input), 'utf8'), { assetId, templateId: option('--template'), displayName: option('--title'), sourceLabel: option('--source-label') })
    console.log(JSON.stringify({ asset: result.asset, revision: result.revision, quality: result.quality }, null, 2))
  } else if (command === 'inspect') {
    console.log(JSON.stringify(await library.getAsset(assetId), null, 2))
  } else {
    throw new Error(`COMMAND_UNKNOWN:${command}`)
  }
}
