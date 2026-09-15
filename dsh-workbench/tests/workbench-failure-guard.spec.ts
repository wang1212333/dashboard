import { expect, it, vi } from 'vitest'
import { registerWorkbenchFailureGuard } from '../src/workbench-failure-guard.js'
it('pauses three consecutive failures, isolates agents, and resets on a new turn', async () => {
  const handlers: Record<string, Function> = {}
  registerWorkbenchFailureGuard({ on: (name: string, fn: Function) => { handlers[name] = fn } } as never)
  const agent = {}, other = {}, next = vi.fn(async () => ({kind:'enter',messages:[]}))
  await handlers['agent/pre-step']({agent,turn:1},next)
  const warn = vi.spyOn(console,'warn').mockImplementation(()=>{})
  try {
    for(let i=0;i<3;i++)handlers['tools/result']({agent,name:'workbench_create_live_dashboard</arg_value>'},{isError:true})
    await expect(handlers['agent/pre-step']({agent,turn:1},next)).rejects.toThrow('连续失败 3 次')
    await expect(handlers['agent/pre-step']({agent:other,turn:1},next)).resolves.toMatchObject({kind:'enter'})
    await expect(handlers['agent/pre-step']({agent,turn:2},next)).resolves.toMatchObject({kind:'enter'})
    expect(JSON.stringify(warn.mock.calls)).not.toContain('arg_value')
  } finally { warn.mockRestore() }
})
