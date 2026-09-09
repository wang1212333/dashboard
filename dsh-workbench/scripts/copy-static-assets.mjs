import { copyFile, mkdir, cp } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const assets = [
  'data-agent-logo-black.png',
  'tabler-icons-LICENSE.txt',
  'jump-to-latest-chevron.png',
]

for (const asset of assets) {
  const source = resolve(root, 'src/local-app/assets', asset)
  const targets = [
    resolve(root, 'dist/local-app/assets', asset),
    resolve(root, 'dist-dashboard/local-app/assets', asset),
  ]
  for (const target of targets) {
    await mkdir(dirname(target), { recursive: true })
    await copyFile(source, target)
  }
}

for (const folder of ['dist', 'dist-dashboard']) {
  await cp(resolve(root, 'src/design-library/lieflat-assets'), resolve(root, folder, 'design-library/lieflat-assets'), { recursive: true })
}
