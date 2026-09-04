import type { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DshModelAnalyzer } from '../src/ai/dsh-model-analyzer.js'
import { NativeDashboardRunService } from '../src/agent-run/native-dashboard-run.js'
import { FilesystemKnowledgeLibrary } from '../src/library/filesystem-library.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

function context(html: string): Context {
  return {
    get: (name: string) => name === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'demo', model: 'native' }) } : undefined,
    llm: { async *stream() { yield { type: 'text-delta', index: 0, text: html }; yield { type: 'finish', reason: { kind: 'stop' } } } },
  } as unknown as Context
}

describe('native DSH dashboard mode', () => {
  it('lets the model return a complete HTML dashboard without a Plan or predefined contract', async () => {
    const analyzer = new DshModelAnalyzer(context('<!doctype html><html><head><title>自由看板</title></head><body><main>自由设计</main></body></html>'))
    const result = await analyzer.generateDashboard({ fileName: 'sample.csv', businessGoal: '自由探索销售表现', csv: 'region,sales\n华东,100' })
    expect(result).toMatchObject({ title: '自由看板', html: expect.stringContaining('<main>自由设计</main>') })
  })

  it('stores a model-authored document as an immutable revision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-native-dashboard-'))
    roots.push(root)
    const library = new FilesystemKnowledgeLibrary(root)
    const stored = await library.buildAgentNativeDraft({ assetId: 'native-sales', title: '自由销售看板', csv: 'region,sales\n华东,100', html: '<!doctype html><html><body><main>销售</main></body></html>' })
    expect(stored).toMatchObject({ revision: { revision: 'rev-0001', stage: 'draft' }, manifest: { dataContract: 'agent-native/v1', templateId: 'agent-native/v1' }, model: { kind: 'agent-native/v1' } })
  })

  it('forwards native model chunks as text.delta events before the dashboard is stored', async () => {
    const planner = {
      async generateDashboard(_input: unknown, _signal: AbortSignal | undefined, onTextDelta?: (delta: string) => void) {
        onTextDelta?.('正在分析')
        await Promise.resolve()
        onTextDelta?.('数据')
        return { html: '<!doctype html><html><body>看板</body></html>', title: '流式看板', summary: '已生成' }
      },
    }
    const library = {
      async buildAgentNativeDraft() {
        return { asset: { assetId: 'streaming-dashboard', displayName: '流式看板' }, revision: { revision: 'rev-0001' } }
      },
    }
    const service = new NativeDashboardRunService(planner, library as never, () => '/preview')
    const events = []
    for await (const event of service.start({ csv: 'region,sales\n华东,100', fileName: 'sample.csv', intent: '查看销售' }).events()) events.push(event)
    expect(events.filter(event => event.type === 'text.delta').map(event => event.data)).toEqual([
      { target: 'dashboard', delta: '正在分析' },
      { target: 'dashboard', delta: '数据' },
    ])
    expect(events.findIndex(event => event.type === 'text.delta')).toBeLessThan(events.findIndex(event => event.type === 'tool.completed' && event.data.toolCallId === 'native-dsh-generate'))
  })
})
