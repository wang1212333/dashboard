import { randomUUID } from 'node:crypto'
import { analyzeCsv } from '../data-ingestion/csv-profile.js'
import type { DashboardPlan } from '../dashboard-agent/contracts.js'

export type DashboardRunEvent =
  | { type: 'run.started'; runId: string; data: { fileName: string } }
  | { type: 'text.started'; runId: string; data: { target: 'plan' } }
  | { type: 'text.delta'; runId: string; data: { target: 'plan'; delta: string } }
  | { type: 'tool.started' | 'tool.progress' | 'tool.completed'; runId: string; data: { toolCallId: string; title: string; detail?: string } }
  | { type: 'finding.created'; runId: string; data: { text: string } }
  | { type: 'list.created'; runId: string; data: { intro: string; items: string[] } }
  | { type: 'plan.created'; runId: string; data: { plan: DashboardPlan } }
  | { type: 'run.completed' | 'run.stopped'; runId: string; data: Record<string, never> }
  | { type: 'run.error'; runId: string; data: { message: string } }

export type DashboardPlanner = {
  createPlan(input: DashboardRunInput, signal?: AbortSignal, onTextDelta?: (delta: string) => void): Promise<DashboardPlan>
}

export type DashboardRunInput = { csv: string; fileName: string; intent: string }
export type DashboardRun = { id: string; signal: AbortSignal; cancel(): void; events(): AsyncIterable<DashboardRunEvent>; status(): 'running' | 'completed' | 'stopped' | 'error' }

type RunStatus = ReturnType<DashboardRun['status']>

/**
 * A small server-side orchestration layer. It intentionally emits only
 * verifiable tool actions and results, never model hidden reasoning or raw
 * HTML response.
 */
export class DashboardAgentRunService {
  private readonly active = new Map<string, { controller: AbortController; status: RunStatus }>()

  constructor(private readonly planner: DashboardPlanner, private readonly savePlan: (plan: DashboardPlan) => void = () => {}) {}

  start(input: DashboardRunInput): DashboardRun {
    const id = randomUUID()
    const controller = new AbortController()
    const entry = { controller, status: 'running' as RunStatus }
    this.active.set(id, entry)
    const self = this
    return {
      id,
      signal: controller.signal,
      cancel: () => controller.abort(),
      status: () => entry.status,
      async *events(): AsyncGenerator<DashboardRunEvent> {
          const emit = (type: DashboardRunEvent['type'], data: DashboardRunEvent['data']): DashboardRunEvent => ({ type, runId: id, data } as DashboardRunEvent)
        try {
          yield emit('run.started', { fileName: input.fileName })
          const profileTool = 'profile-csv'
          yield emit('tool.started', { toolCallId: profileTool, title: `读取并分析文件 · ${input.fileName}` })
          const analysis = analyzeCsv(input.csv)
          throwIfAborted(controller.signal)
          yield emit('tool.completed', { toolCallId: profileTool, title: `已读取文件 · ${input.fileName}`, detail: `${analysis.rowCount.toLocaleString('zh-CN')} 行，${analysis.fields.length} 个字段` })
          const planTool = 'create-dashboard-plan'
          yield emit('tool.started', { toolCallId: planTool, title: '生成可确认的看板方案' })
          let proposedPlan: DashboardPlan | undefined
          let planningError: unknown
          let planningDone = false
          let generatedCharacters = 0
          void self.planner.createPlan(input, controller.signal, delta => { generatedCharacters += delta.length }).then(
            result => { proposedPlan = result; planningDone = true },
            error => { planningError = error; planningDone = true },
          )
          let reportedCharacters = -1
          while (!planningDone) {
            await wait(650, controller.signal)
            const title = generatedCharacters > 0 ? `正在完善看板方案 · 已接收 ${generatedCharacters.toLocaleString('zh-CN')} 个字符` : '正在生成可确认的看板方案'
            if (generatedCharacters !== reportedCharacters || reportedCharacters < 0) {
              reportedCharacters = generatedCharacters
              yield emit('tool.progress', { toolCallId: planTool, title })
            }
          }
          if (planningError) throw planningError
          if (!proposedPlan) throw new Error('DASHBOARD_PLAN_EMPTY')
          throwIfAborted(controller.signal)
          self.savePlan(proposedPlan)
          yield emit('tool.completed', { toolCallId: planTool, title: '看板方案已生成，等待统一确认' })
          yield emit('plan.created', { plan: proposedPlan })
          yield emit('finding.created', { text: `已提出 ${proposedPlan.metrics.length} 个 KPI、${proposedPlan.charts.length} 个图表和 ${proposedPlan.risks.length} 项数据风险；确认业务意图与故事线后即可生成 HTML。` })
          entry.status = 'completed'
          yield emit('run.completed', {})
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) {
            entry.status = 'stopped'
            yield emit('run.stopped', {})
          } else {
            entry.status = 'error'
            yield emit('run.error', { message: publicError(error) })
          }
        } finally {
          self.active.delete(id)
        }
      },
    }
  }

  cancel(runId: string): boolean {
    const entry = this.active.get(runId)
    if (!entry || entry.status !== 'running') return false
    entry.controller.abort()
    return true
  }
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds)
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
  })
}
function throwIfAborted(signal: AbortSignal): void { if (signal.aborted) throw new DOMException('Aborted', 'AbortError') }
function isAbortError(error: unknown): boolean { return error instanceof DOMException && error.name === 'AbortError' }
function publicError(error: unknown): string { return (error instanceof Error ? error.message : '看板生成失败').replace(/[\r\n]+/g, ' ').slice(0, 180) }
