import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { DshModelAnalyzer } from '../src/ai/dsh-model-analyzer.js'
import type { WorkbenchTracer } from '../src/observability/phoenix.js'

const csv = `period,revenue,cost,region
2026-08,100,60,泰国
2026-09,120,70,越南`

function context(reply: string, route: { provider: string; model: string } | undefined = { provider: 'demo', model: 'model-a' }): Context {
  return {
    get: (name: string) => name === 'agentDefaultModel' && route ? { currentSelection: () => route } : undefined,
    llm: {
      async *stream() {
        yield { type: 'text-delta', index: 0, text: reply }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    },
  } as unknown as Context
}

describe('DSH model analyzer', () => {
  it('uses the active DSH route and accepts only known field mappings', async () => {
    const analyzer = new DshModelAnalyzer(context(JSON.stringify({
      templateId: 'finance-pnl-v1', confidence: 93, reason: '包含期间、收入、成本和区域。', summary: '收入持续增长。',
      mapping: { period: 'period', revenue: 'revenue', cost: 'cost', dimension: 'region', injected: 'not-a-column' },
    })))
    const result = await analyzer.analyze(csv)
    expect(result.ai).toMatchObject({ status: 'used', provider: 'demo', model: 'model-a', summary: '收入持续增长。' })
    expect(result.recommendations[0]).toMatchObject({ templateId: 'finance-pnl-v1', mapping: { period: 'period', revenue: 'revenue', cost: 'cost', dimension: 'region' } })
  })

  it('wraps each configured DSH model call in the host-side tracer', async () => {
    const observed: Array<{ provider: string; model: string; rowCount: number; fieldCount: number; prompt: string }> = []
    const tracer: WorkbenchTracer = {
      async traceModelCall(input, operation) { observed.push(input); return operation() },
      async shutdown() {},
    }
    const analyzer = new DshModelAnalyzer(context(JSON.stringify({ templateId: 'finance-pnl-v1', confidence: 93, reason: '字段完整。', mapping: { period: 'period', revenue: 'revenue', cost: 'cost', dimension: 'region' } })), tracer)
    await analyzer.analyze(csv)
    expect(observed).toEqual([expect.objectContaining({ provider: 'demo', model: 'model-a', rowCount: 2, fieldCount: 4, prompt: expect.stringContaining('分析以下 CSV 字段画像') })])
  })

  it('keeps the deterministic rule result when no model is configured', async () => {
    const analyzer = new DshModelAnalyzer(context('', undefined))
    await expect(analyzer.analyze(csv)).resolves.toMatchObject({ ai: { status: 'rules-only' } })
  })

  it('recovers a schema-shaped proposal when model prose makes its JSON invalid', async () => {
    const analyzer = new DshModelAnalyzer(context(`{
      "templateId": "finance-pnl-v1",
      "mapping": { "period": "period", "revenue": "revenue", "cost": "cost" },
      "confidence": 88,
      "reason": "收入字段被模型称为 "主营收入""
    }`))
    const result = await analyzer.analyze(csv)
    expect(result.ai.status).toBe('used')
    expect(result.recommendations[0]).toMatchObject({ templateId: 'finance-pnl-v1', confidence: 88 })
  })

})
