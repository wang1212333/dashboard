import { randomUUID } from 'node:crypto'
import type { KnowledgeLibrary } from '../library/knowledge-library.js'

export type NativeDashboardRunEvent =
  | { type: 'run.started'; runId: string; data: { fileName: string } }
  | { type: 'tool.started' | 'tool.progress' | 'tool.completed'; runId: string; data: { toolCallId: string; title: string; detail?: string } }
  | { type: 'text.delta'; runId: string; data: { target: 'dashboard'; delta: string } }
  | { type: 'artifact.created'; runId: string; data: { title: string; previewUrl: string } }
  | { type: 'finding.created'; runId: string; data: { text: string } }
  | { type: 'run.completed' | 'run.stopped'; runId: string; data: Record<string, never> }
  | { type: 'run.error'; runId: string; data: { message: string } }

export interface NativeDashboardPlanner {
  generateDashboard(input: { csv: string; fileName: string; businessGoal: string }, signal?: AbortSignal, onTextDelta?: (delta: string) => void): Promise<{ html: string; title: string; summary: string }>
}

/** The default DSH-web workflow: one autonomous model turn, then immutable storage. */
export class NativeDashboardRunService {
  private readonly active = new Map<string, AbortController>()
  constructor(private readonly planner: NativeDashboardPlanner, private readonly library: KnowledgeLibrary, private readonly previewUrl: (assetId: string, revision: string) => string) {}

  start(input: { csv: string; fileName: string; intent: string }) {
    const runId = randomUUID()
    const controller = new AbortController()
    this.active.set(runId, controller)
    const assetId = `dashboard-${runId.replace(/-/g, '').slice(0, 16)}`
    const self = this
    return {
      id: runId,
      cancel: () => controller.abort(),
      async *events(): AsyncGenerator<NativeDashboardRunEvent> {
        const event = (type: NativeDashboardRunEvent['type'], data: NativeDashboardRunEvent['data']) => ({ type, runId, data } as NativeDashboardRunEvent)
        try {
          yield event('run.started', { fileName: input.fileName })
          yield event('tool.started', { toolCallId: 'native-dsh-generate', title: 'DeepSeek Harness 正在自主生成看板' })
          let characters = 0
          const generated = await self.planner.generateDashboard({ csv: input.csv, fileName: input.fileName, businessGoal: input.intent }, controller.signal, delta => { characters += delta.length })
          if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError')
          yield event('tool.completed', { toolCallId: 'native-dsh-generate', title: '原生 Agent 已完成看板设计', detail: `生成 ${characters.toLocaleString('zh-CN')} 个字符` })
          yield event('tool.started', { toolCallId: 'save-dashboard', title: '保存生成的看板' })
          const stored = await self.library.buildAgentNativeDraft({ assetId, html: generated.html, title: generated.title, summary: generated.summary, csv: input.csv, sourceLabel: input.fileName })
          yield event('tool.completed', { toolCallId: 'save-dashboard', title: '看板已保存' })
          yield event('artifact.created', { title: stored.asset.displayName, previewUrl: self.previewUrl(stored.asset.assetId, stored.revision.revision) })
          yield event('finding.created', { text: generated.summary })
          yield event('run.completed', {})
        } catch (error) {
          if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) yield event('run.stopped', {})
          else yield event('run.error', { message: (error instanceof Error ? error.message : '看板生成失败').replace(/[\r\n]+/g, ' ').slice(0, 180) })
        } finally { self.active.delete(runId) }
      },
    }
  }

  cancel(runId: string): boolean {
    const controller = this.active.get(runId)
    if (!controller) return false
    controller.abort()
    return true
  }
}
