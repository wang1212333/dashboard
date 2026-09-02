import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'src/local-app/assets/data-agent-logo-black.png')
const targets = [
  resolve(root, 'dist/local-app/assets/data-agent-logo-black.png'),
  resolve(root, 'dist-dashboard/local-app/assets/data-agent-logo-black.png'),
]

for (const target of targets) {
  await mkdir(dirname(target), { recursive: true })
  await copyFile(source, target)
}
