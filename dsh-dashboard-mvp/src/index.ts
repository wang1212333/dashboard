import type { Context } from '@deepseek-ai/cordis'
import { registerDashboardTools } from './tools.js'

export const name = 'dsh-dashboard-mvp'
export const inject = ['tools']

/** Minimal DSH plugin entry: it registers only the five-step dashboard flow. */
export function apply(ctx: Context): void {
  registerDashboardTools(ctx)
}
