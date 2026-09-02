import type { Context } from '@deepseek-ai/cordis'
import { resolve } from 'node:path'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-llm'
import { DshModelAnalyzer } from './ai/dsh-model-analyzer.js'
import { createKnowledgeLibrary } from './library/factory.js'
import type { IdentityProvider } from './library/ports.js'
import type { WorkbenchPluginConfig } from './service.js'
import { registerWorkbenchTools } from './tools.js'
import { makeWorkbenchWebRoutes } from './web-ui/host-routes.js'
import { createWorkbenchTracer } from './observability/phoenix.js'
import { HeadlessDashboardAgentService } from './headless-dashboard-agent.js'

export const name = 'dsh-workbench'
export const inject = ['tools', 'webServer', 'llm', 'agents']

/** DSH bundle entry point: Harness loads this after the tool runtime is ready. */
export function apply(ctx: Context, config: WorkbenchPluginConfig = {}): void {
  register(ctx, config)
}

/** Production bootstrap calls this with identity resolved from trusted host session middleware. */
export function applyWithIdentity(ctx: Context, config: WorkbenchPluginConfig, identity: IdentityProvider): void {
  register(ctx, config, identity)
}

function register(ctx: Context, config: WorkbenchPluginConfig, identity?: IdentityProvider): void {
  const library = createKnowledgeLibrary(config, identity)
  const tracer = createWorkbenchTracer()
  const modelAnalyzer = new DshModelAnalyzer(ctx, tracer)
  const uploadRoot = config.libraryRoot ?? './dsh-workbench-library'
  const headlessAgents = new HeadlessDashboardAgentService(ctx, resolve(uploadRoot))
  registerWorkbenchTools(ctx, library)
  ctx.effect(() => {
    const disposers = makeWorkbenchWebRoutes(library, modelAnalyzer, uploadRoot, headlessAgents).map(route => ctx.webServer.register(route))
    return () => { disposers.forEach(dispose => dispose()); void modelAnalyzer.shutdownTracing() }
  }, 'dsh-workbench: same-origin web workbench routes')
}
