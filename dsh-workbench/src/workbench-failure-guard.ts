import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'

/** Per-agent and per-turn circuit breaker, including malformed tool names. */
export function registerWorkbenchFailureGuard(ctx: Context): void {
  const states = new WeakMap<object, { turn: number; failures: number }>()
  ctx.on('tools/result', (exec, result) => {
    if (!exec.agent || !exec.name.startsWith('workbench')) return
    const state = states.get(exec.agent)
    if (!state) return
    const value = !result.isError ? result.value : undefined
    const failed = result.isError || (value !== null && typeof value === 'object' && !Array.isArray(value) && value?.ok === false)
    state.failures = failed ? state.failures + 1 : 0
    if (failed) console.warn('[workbench-tool-failure]', JSON.stringify({ tool: /^[a-z_]+$/.test(exec.name) ? exec.name : '[malformed-name]', consecutive: state.failures }))
  })
  ctx.on('agent/pre-step', async ({ agent, turn }, next) => {
    const previous = states.get(agent)
    if (!previous || previous.turn !== turn) states.set(agent, { turn, failures: 0 })
    else if (previous.failures >= 3) throw new Error('看板工具连续失败 3 次，已停止本轮生成。已保存的草稿不受影响，请检查参数或调用协议后再继续。')
    return next()
  })
}
