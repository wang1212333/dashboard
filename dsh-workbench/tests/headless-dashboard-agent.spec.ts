import { describe, expect, it, vi } from 'vitest'
import { HeadlessDashboardAgentService, isLeakedHttpErrorHtml } from '../src/headless-dashboard-agent.js'

describe('headless dashboard agent output safety', () => {
  it('recognizes an upstream HTTP error document before it reaches the conversation', () => {
    expect(isLeakedHttpErrorHtml('405 <!DOCTYPE html><html lang="zh-cn"><meta http-equiv="X-UA-Compatible">')).toBe(true)
  })

  it('keeps ordinary assistant prose available to the conversation', () => {
    expect(isLeakedHttpErrorHtml('该数据集包含 6 个字段，其中 3 个是日期字段。')).toBe(false)
  })

  it('streams the server-verified upload profile before the model starts its turn', async () => {
    const handlers = new Map<string, Function>()
    const agent = { id: 'agent-1', followup: vi.fn(), cancel: vi.fn() }
    const ctx = {
      on: (name: string, handler: Function) => handlers.set(name, handler),
      get: () => ({ currentSelection: () => ({ provider: 'test', model: 'test-model' }) }),
      agents: { create: vi.fn(async () => ({ agent })), get: vi.fn(() => agent) },
      tools: { register: vi.fn() },
    }
    const service = new HeadlessDashboardAgentService(ctx as never, '.')
    const sessionId = await service.create({
      filePath: 'C:/uploads/sales.csv', fileName: 'sales.csv', rowCount: 12, fieldCount: 2, fields: ['日期', '销售额'],
    })
    const events: Array<{ type: string; data: Record<string, unknown> }> = []
    service.subscribe(sessionId, event => events.push(event))

    service.send(sessionId, '有哪些数据信息')

    expect(events).toContainEqual({ type: 'assistant.delta', data: { text: '已读取数据文件「sales.csv」。\n当前识别到 12 行、2 个字段。\n字段：日期、销售额。\n\n' } })
    expect(agent.followup).toHaveBeenCalledOnce()
  })

  it('converts a leaked HTTP document into a final error instead of a completed answer', async () => {
    const handlers = new Map<string, Function>()
    const agent = { id: 'agent-1', followup: vi.fn(), cancel: vi.fn() }
    const ctx = {
      on: (name: string, handler: Function) => handlers.set(name, handler),
      get: () => ({ currentSelection: () => ({ provider: 'test', model: 'test-model' }) }),
      agents: { create: vi.fn(async () => ({ agent })), get: vi.fn(() => agent) },
      tools: { register: vi.fn() },
    }
    const service = new HeadlessDashboardAgentService(ctx as never, '.')
    const sessionId = await service.create()
    const events: Array<{ type: string; data: Record<string, unknown> }> = []
    service.subscribe(sessionId, event => events.push(event))

    handlers.get('session/event')({ id: sessionId }, { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: '405 <!DOCTYPE html><html lang="zh-cn">' } } })
    handlers.get('agent/status')({ agent, status: 'idle' })

    expect(events.some(event => event.type === 'assistant.delta')).toBe(false)
    expect(events).toContainEqual({ type: 'agent.error', data: { message: '数据已读取，但回答生成服务返回了异常响应。请重试。' } })
    expect(events.some(event => event.type === 'agent.completed')).toBe(false)
  })

})
