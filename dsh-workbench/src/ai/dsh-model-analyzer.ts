import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { analyzeCsv, type CsvAnalysis, type DashboardFieldMapping } from '../data-ingestion/csv-profile.js'
import { createWorkbenchTracer, type WorkbenchTracer } from '../observability/phoenix.js'

const TEMPLATE_IDS = new Set(['content-ops-v1', 'finance-pnl-v1', 'supply-sales-v1', 'sku-operations-v1'])
const MAX_MODEL_OUTPUT_CHARS = 24_000
const MAX_MODEL_SAMPLE_ROWS = 24

type ModelRoute = { provider: string; model: string }
type AgentDefaultModel = { currentSelection(): Partial<ModelRoute> }

export interface ModelAnalysisInfo {
  status: 'used' | 'rules-only'
  provider?: string
  model?: string
  message?: string
  summary?: string
  warnings?: string[]
}

export type EnrichedCsvAnalysis = CsvAnalysis & { ai: ModelAnalysisInfo }

/**
 * Model-assisted analysis is deliberately advisory: deterministic profiling
 * always runs first, and the model may only select a known template and known
 * input columns. This keeps Draft validation authoritative and replayable.
 */
export class DshModelAnalyzer {
  constructor(private readonly ctx: Context, private readonly tracer: WorkbenchTracer = createWorkbenchTracer()) {}

  async analyze(csv: string, businessGoal?: string): Promise<EnrichedCsvAnalysis> {
    const rules = analyzeCsv(csv)
    const route = this.currentRoute()
    if (route === undefined) return { ...rules, ai: { status: 'rules-only', message: '未读取到 DSH 当前模型，已使用规则分析。' } }
    try {
      const raw = await this.askModel(route, rules, businessGoal)
      const proposal = parseProposal(raw)
      const enriched = mergeProposal(rules, proposal)
      return { ...enriched, ai: { status: 'used', provider: route.provider, model: route.model, summary: proposal.summary, warnings: proposal.warnings } }
    } catch (error) {
      return { ...rules, ai: { status: 'rules-only', provider: route.provider, model: route.model, message: `模型分析未完成，已使用规则分析：${publicError(error)}` } }
    }
  }

  private currentRoute(): ModelRoute | undefined {
    const service = this.ctx.get('agentDefaultModel') as AgentDefaultModel | undefined
    const selection = service?.currentSelection()
    if (typeof selection?.provider !== 'string' || !selection.provider || typeof selection.model !== 'string' || !selection.model) return undefined
    return { provider: selection.provider, model: selection.model }
  }

  private async askModel(route: ModelRoute, analysis: CsvAnalysis, businessGoal?: string): Promise<string> {
    const prompt = promptFor(analysis, businessGoal)
    return this.tracer.traceModelCall({ provider: route.provider, model: route.model, prompt, maxTokens: 1_400, temperature: 0.1, rowCount: analysis.rowCount, fieldCount: analysis.fields.length }, () => this.stream(route, prompt))
  }

  async shutdownTracing(): Promise<void> { await this.tracer.shutdown() }

  private async stream(route: ModelRoute, prompt: string, maxTokens = 1_400, maxChars = MAX_MODEL_OUTPUT_CHARS, system = '你是企业数据分析助手。仅基于提供的字段画像提出可审阅的看板建议；绝不虚构数据、字段或计算结果。', signal?: AbortSignal, onTextDelta?: (delta: string) => void): Promise<string> {
    const message = createUserMessage({
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'plugin', plugin: 'dsh-workbench', form: 'notice', summary: '看板工作台请求数据结构分析' },
    })
    const options: GenerateOptions = {
      provider: route.provider,
      model: route.model,
      messages: [message],
      system,
      temperature: 0.1,
      maxTokens,
      signal,
    }
    let text = ''
    for await (const chunk of this.ctx.llm.stream(options)) {
      if (chunk.type === 'text-delta') {
        text += chunk.text
        onTextDelta?.(chunk.text)
        if (text.length > maxChars) throw new Error('MODEL_OUTPUT_TOO_LARGE')
      }
      if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) throw new Error(chunk.reason.failure.message)
    }
    if (!text.trim()) throw new Error('MODEL_EMPTY_RESPONSE')
    return text
  }
}

type ModelProposal = { templateId: string; mapping: DashboardFieldMapping; confidence: number; reason: string; summary?: string; warnings?: string[] }

function promptFor(analysis: CsvAnalysis, businessGoal?: string): string {
  const compact = {
    rowCount: analysis.rowCount,
    fields: analysis.fields.map(field => ({ name: field.name, inferredType: field.inferredType, nonEmpty: field.nonEmpty, samples: field.samples.slice(0, 3) })),
    previewRows: analysis.previewRows.slice(0, MAX_MODEL_SAMPLE_ROWS),
    ruleRecommendations: analysis.recommendations,
    templates: {
      'content-ops-v1': ['date', 'category', 'planned', 'published', 'views', 'conversions', 'revenue'],
      'finance-pnl-v1': ['period', 'dimension?', 'revenue?', 'cost?', 'profit?'],
      'supply-sales-v1': ['period', 'country', 'forecast', 'shipments', 'sellIn', 'sellOut', 'inventory', 'dos?'],
      'sku-operations-v1': ['period', 'item', 'inventory', 'sellOut?', 'dos?', 'targetDos?', 'region?', 'country?'],
    },
  }
  return `分析以下 CSV 字段画像，选择最适合的唯一看板模板，并给出字段映射建议。业务目标：${businessGoal?.trim() || '未提供；以数据能够支持的问题为准'}。只可使用 templates 中的 templateId、fields 中存在的列名和指定 role。若选择 sku-operations-v1，它是动态故事线工作台：只在数据支持时推荐库存/周转/结构诊断，绝不默认推荐情景模拟、流程或行动任务。返回纯 JSON，不要 Markdown：\n{"templateId":"content-ops-v1|finance-pnl-v1|supply-sales-v1|sku-operations-v1","mapping":{"role":"输入列名"},"confidence":0-100,"reason":"一句原因","summary":"一句基于字段的业务观察","warnings":["需要人确认的口径"]}\n输入：${JSON.stringify(compact)}`
}

function parseProposal(raw: string): ModelProposal {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fence?.[1] ?? raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
  let value: Record<string, unknown>
  try {
    value = JSON.parse(candidate) as Record<string, unknown>
  } catch {
    // Some otherwise capable models occasionally emit an unescaped quote in
    // explanatory Chinese text. Recover only the fixed, schema-shaped fields;
    // never evaluate model text as JavaScript or accept arbitrary structure.
    const templateId = /["']templateId["']\s*:\s*["']([^"']+)["']/i.exec(candidate)?.[1]
    const mappingBody = /["']mapping["']\s*:\s*\{([\s\S]*?)\}/i.exec(candidate)?.[1]
    if (!templateId || !mappingBody) throw new Error('MODEL_JSON_INVALID')
    const mapping = Object.fromEntries([...mappingBody.matchAll(/["']([^"']+)["']\s*:\s*["']([^"']*)["']/g)].map(([, role, column]) => [role, column]))
    const confidence = /["']confidence["']\s*:\s*["']?(\d{1,3})/i.exec(candidate)?.[1]
    const reason = /["']reason["']\s*:\s*["']([^\r\n"']*)/i.exec(candidate)?.[1]
    const summary = /["']summary["']\s*:\s*["']([^\r\n"']*)/i.exec(candidate)?.[1]
    value = { templateId, mapping, ...(confidence ? { confidence } : {}), ...(reason ? { reason } : {}), ...(summary ? { summary } : {}) }
  }
  if (!TEMPLATE_IDS.has(value.templateId as string)) throw new Error('MODEL_TEMPLATE_INVALID')
  const mapping = value.mapping && typeof value.mapping === 'object' && !Array.isArray(value.mapping)
    ? Object.fromEntries(Object.entries(value.mapping).filter(([, column]) => typeof column === 'string').map(([role, column]) => [role, (column as string).trim()]))
    : {}
  return {
    templateId: value.templateId as string,
    mapping,
    confidence: Math.max(0, Math.min(100, Math.round(Number(value.confidence) || 0))),
    reason: typeof value.reason === 'string' ? value.reason.slice(0, 500) : '模型建议的字段映射。',
    ...(typeof value.summary === 'string' ? { summary: value.summary.slice(0, 500) } : {}),
    ...(Array.isArray(value.warnings) ? { warnings: value.warnings.filter(item => typeof item === 'string').map(item => item.slice(0, 300)).slice(0, 8) } : {}),
  }
}

function mergeProposal(rules: CsvAnalysis, proposal: ModelProposal): CsvAnalysis {
  const headers = new Set(rules.headers)
  const mapping = Object.fromEntries(Object.entries(proposal.mapping).filter(([, column]) => typeof column === 'string' && headers.has(column)))
  const fallback = rules.recommendations.filter(item => item.templateId !== proposal.templateId)
  return { ...rules, recommendations: [{ templateId: proposal.templateId as CsvAnalysis['recommendations'][number]['templateId'], confidence: proposal.confidence, reason: proposal.reason, mapping }, ...fallback] }
}

function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : '未知错误'
  return message.replace(/[\r\n]+/g, ' ').slice(0, 180)
}
