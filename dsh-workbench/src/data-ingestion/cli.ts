import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { analyzeCsv } from './csv-profile.js'

const input = process.argv[2]
if (!input) {
  console.error('Usage: pnpm dataset:analyze -- <input.csv>')
  process.exitCode = 2
} else {
  console.log(JSON.stringify(analyzeCsv(await readFile(resolve(input), 'utf8')), null, 2))
}
