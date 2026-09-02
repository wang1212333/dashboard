import { resolve } from 'node:path'
import { startLocalWorkbenchApp } from './server.js'

const args = process.argv.slice(2)
const option = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined }
const port = Number(option('--port') ?? '4317')
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT_INVALID')
const app = await startLocalWorkbenchApp({ libraryRoot: resolve(option('--library') ?? 'outputs/local-app-library'), port })
console.log(`DSH workbench import page: ${app.url}`)
