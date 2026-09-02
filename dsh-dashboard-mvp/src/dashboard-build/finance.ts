import { validateOfflineDashboard } from '../dashboard-export/validator.js'
import { parseTabularCsv, type DashboardFieldMapping } from '../data-ingestion/csv-profile.js'
import type { DashboardBuildResult, FinanceDashboardModel } from './contracts.js'
import type { BuildDashboardOptions } from './build.js'
import { getDashboardTemplate } from './templates.js'
import { defaultDashboardVisualContract, trustSectionHtml, visualContractCss, type DashboardVisualContract } from './universal-contract.js'

interface FinanceRecord { period: string; dimension: string; revenue: number; cost: number; profit: number }
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
const ratio = (a: number, b: number) => b === 0 ? 0 : a / b

function numberValue(value: string | undefined, field: string): number {
  if (!value?.trim()) return 0
  const cleaned = value.replace(/[¥￥$,\s]/g, '').replace(/^\((.*)\)$/, '-$1')
  const parsed = Number(cleaned)
  if (!Number.isFinite(parsed)) throw new Error(`FINANCE_NUMBER_INVALID:${field}`)
  return parsed
}

function mappedValue(row: Record<string, string>, mapping: DashboardFieldMapping, role: string): string | undefined {
  const column = mapping[role]
  return column ? row[column] : undefined
}

function parseFinanceRecords(csv: string, mapping: DashboardFieldMapping): { records: FinanceRecord[]; rejectedRows: Array<{ row: number; reason: string }> } {
  const dataset = parseTabularCsv(csv)
  if (!mapping.period || !dataset.headers.includes(mapping.period)) throw new Error('MAPPING_REQUIRED:period')
  if (!mapping.revenue && !mapping.profit) throw new Error('MAPPING_REQUIRED:revenue_or_profit')
  const records: FinanceRecord[] = []
  const rejectedRows: Array<{ row: number; reason: string }> = []
  dataset.rows.forEach((row, index) => {
    try {
      const period = mappedValue(row, mapping, 'period')?.trim()
      if (!period) throw new Error('PERIOD_REQUIRED')
      const revenue = numberValue(mappedValue(row, mapping, 'revenue'), 'revenue')
      const cost = numberValue(mappedValue(row, mapping, 'cost'), 'cost')
      const suppliedProfit = mappedValue(row, mapping, 'profit')
      const profit = suppliedProfit?.trim() ? numberValue(suppliedProfit, 'profit') : revenue - cost
      records.push({ period, dimension: mappedValue(row, mapping, 'dimension')?.trim() || '未分类', revenue, cost, profit })
    } catch (error) {
      rejectedRows.push({ row: index + 2, reason: error instanceof Error ? error.message : 'INVALID_ROW' })
    }
  })
  if (!records.length) throw new Error('FINANCE_HAS_NO_VALID_RECORDS')
  return { records, rejectedRows }
}

function createFinanceModel(records: FinanceRecord[]): FinanceDashboardModel {
  const revenue = sum(records.map((record) => record.revenue))
  const cost = sum(records.map((record) => record.cost))
  const profit = sum(records.map((record) => record.profit))
  const byPeriod = new Map<string, FinanceRecord[]>()
  const byDimension = new Map<string, FinanceRecord[]>()
  for (const record of records) {
    byPeriod.set(record.period, [...(byPeriod.get(record.period) ?? []), record])
    byDimension.set(record.dimension, [...(byDimension.get(record.dimension) ?? []), record])
  }
  const trend = [...byPeriod.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([period, values]) => ({ period, revenue: sum(values.map((value) => value.revenue)), cost: sum(values.map((value) => value.cost)), profit: sum(values.map((value) => value.profit)) }))
  const dimensions = [...byDimension.entries()].map(([dimension, values]) => {
    const dimensionRevenue = sum(values.map((value) => value.revenue))
    const dimensionProfit = sum(values.map((value) => value.profit))
    return { dimension, revenue: dimensionRevenue, cost: sum(values.map((value) => value.cost)), profit: dimensionProfit, profitMargin: ratio(dimensionProfit, dimensionRevenue) }
  }).sort((left, right) => right.profit - left.profit)
  const weakest = [...dimensions].sort((left, right) => left.profitMargin - right.profitMargin)[0]
  const margin = ratio(profit, revenue)
  const timeframe = `${trend[0].period} 至 ${trend.at(-1)!.period}`
  const conclusion = profit >= 0 ? `累计利润为 ¥${profit.toFixed(0)}，利润率 ${(margin * 100).toFixed(1)}%。` : `当前累计亏损 ¥${Math.abs(profit).toFixed(0)}，需优先检查成本与收入确认。`
  return {
    kind: 'finance-pnl-v1', timeframe, freshness: new Date().toISOString(), conclusion,
    kpis: { revenue, cost, profit, profitMargin: margin, costRatio: ratio(cost, revenue) }, trend, dimensions,
    diagnostic: weakest ? `${weakest.dimension} 的利润率为 ${(weakest.profitMargin * 100).toFixed(1)}%，是当前最需要复核的维度。` : '维度信息不足，暂无法定位利润差异。',
    actions: [
      { priority: profit < 0 ? '高' : '中', evidence: `累计利润 ¥${profit.toFixed(0)}`, nextStep: profit < 0 ? '核对亏损项目的收入确认与成本归集。' : '保持盈利项目的经营节奏并复核可持续性。', expectedDirection: '改善利润表现' },
      { priority: '高', evidence: `成本率 ${(ratio(cost, revenue) * 100).toFixed(1)}%`, nextStep: '拆解高成本维度，核对固定与可变成本。', expectedDirection: '降低成本率' },
      { priority: '中', evidence: weakest ? `${weakest.dimension} 利润率 ${(weakest.profitMargin * 100).toFixed(1)}%` : '缺少维度数据', nextStep: weakest ? `针对 ${weakest.dimension} 制定专项改善方案。` : '补充项目、部门或产品维度。', expectedDirection: '缩小维度间利润差异' },
    ],
  }
}

const money = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(value)
const percent = (value: number) => `${(value * 100).toFixed(1)}%`
const safe = (value: string | number) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)

function renderFinanceDashboard(model: FinanceDashboardModel, options: { visualContract?: DashboardVisualContract; sourceLabel?: string; semanticStatus?: string; evidenceCount?: number } = {}): string {
  const visual = options.visualContract ?? defaultDashboardVisualContract()
  const maximum = Math.max(...model.trend.map((item) => Math.max(Math.abs(item.revenue), Math.abs(item.cost), Math.abs(item.profit))), 1)
  const trend = model.trend.map((item) => `<div class="bar"><span>${safe(item.period)}</span><i style="width:${Math.max(2, Math.abs(item.profit) / maximum * 100)}%"></i><b>¥${money(item.profit)}</b></div>`).join('')
  const rows = model.dimensions.map((item) => `<tr><td>${safe(item.dimension)}</td><td>¥${money(item.revenue)}</td><td>¥${money(item.cost)}</td><td>¥${money(item.profit)}</td><td>${percent(item.profitMargin)}</td></tr>`).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>财务利润看板</title><style>:root{--ink:#172033;--muted:#667085;--line:#dfe4ed;--brand:#246b5a;--soft:#f4f8f6;--good:#087e65;--bad:#b42318}*{box-sizing:border-box}body{margin:0;background:#f4f6fa;color:var(--ink);font:14px/1.6 "Microsoft YaHei",Arial,sans-serif}.wrap{width:min(1160px,calc(100% - 32px));margin:auto}header{padding:36px 0;background:linear-gradient(135deg,#173d35,#2d7b68);color:#fff}h1{margin:0;font-size:30px}.sub{color:#d8f2ea;margin:8px 0}.fresh{font-size:12px;color:#bfe4d8}.grid{display:grid;gap:16px}.kpis{grid-template-columns:repeat(4,1fr);margin-top:-22px}.card,section,.action{background:#fff;border:1px solid var(--line);border-radius:12px;padding:20px}.label,.hint{font-size:12px;color:var(--muted)}.value{font-size:27px;font-weight:700;margin:6px 0}.bad{color:var(--bad)}main{padding:34px 0 60px}section{margin-top:18px}h2{font-size:18px;margin:0 0 14px}.two{grid-template-columns:1.2fr .8fr}.bar{display:grid;grid-template-columns:80px 1fr 100px;gap:10px;align-items:center;margin:12px 0}.bar i{height:10px;display:block;background:var(--brand);border-radius:99px}.diagnostic{border-left:4px solid #c4882b;background:#fff9eb}.actions{grid-template-columns:repeat(3,1fr)}.action b{color:#a36106}table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid var(--line);text-align:left}th{font-size:12px;color:var(--muted)}@media(max-width:760px){.kpis,.two,.actions{grid-template-columns:1fr}.kpis{margin-top:16px}.bar{grid-template-columns:65px 1fr 82px}}@media(prefers-color-scheme:dark){body{background:#101827;color:#edf2ff}.card,section,.action{background:#182236;border-color:#33415a}.hint,.label,th{color:#a8b4c9}}</style></head><body><header data-dashboard-role="summary" data-freshness="${safe(model.freshness)}"><div class="wrap"><h1>财务利润看板</h1><p class="sub">${safe(model.timeframe)} · ${safe(model.conclusion)}</p><span class="fresh">数据更新至 ${safe(model.freshness.replace('T',' ').slice(0,19))}</span></div></header><main class="wrap"><section data-dashboard-role="filters"><strong>查看范围</strong><span class="hint"> ${safe(model.timeframe)} · 全部已映射维度</span></section><div class="grid kpis"><article class="card" data-dashboard-role="kpi"><div class="label">累计收入</div><div class="value">¥${money(model.kpis.revenue)}</div></article><article class="card" data-dashboard-role="kpi"><div class="label">累计成本</div><div class="value">¥${money(model.kpis.cost)}</div></article><article class="card" data-dashboard-role="kpi"><div class="label">累计利润</div><div class="value ${model.kpis.profit<0?'bad':''}">¥${money(model.kpis.profit)}</div></article><article class="card" data-dashboard-role="kpi"><div class="label">利润率</div><div class="value">${percent(model.kpis.profitMargin)}</div><span class="hint">成本率 ${percent(model.kpis.costRatio)}</span></article></div><div class="grid two"><section data-dashboard-role="trend"><h2>利润趋势</h2>${trend}<p class="hint">柱形长度表示各期间利润绝对值。</p></section><section data-dashboard-role="diagnostic" class="diagnostic"><h2>经营诊断</h2><p>${safe(model.diagnostic)}</p></section></div><section data-dashboard-role="actions"><h2>建议行动</h2><div class="grid actions">${model.actions.map((item)=>`<article class="action"><b>${item.priority}优先级</b><p><strong>证据：</strong>${safe(item.evidence)}</p><p><strong>下一步：</strong>${safe(item.nextStep)}</p><p><strong>预期：</strong>${safe(item.expectedDirection)}</p></article>`).join('')}</div></section><section data-dashboard-role="detail"><h2>维度利润表现</h2><div style="overflow:auto"><table><thead><tr><th>维度</th><th>收入</th><th>成本</th><th>利润</th><th>利润率</th></tr></thead><tbody>${rows}</tbody></table></div></section>${trustSectionHtml({ sourceLabel: options.sourceLabel, freshness: model.freshness, semanticStatus: options.semanticStatus, evidenceCount: options.evidenceCount })}</main>${visualContractCss(visual)}</body></html>`
}

export function buildFinanceDashboardFromCsv(csv: string, options: BuildDashboardOptions): DashboardBuildResult {
  const template = getDashboardTemplate('finance-pnl-v1')
  const parsed = parseFinanceRecords(csv, options.mapping ?? {})
  const model = createFinanceModel(parsed.records)
  const html = renderFinanceDashboard(model, { visualContract: options.spec?.visualContract, sourceLabel: options.sourceLabel, semanticStatus: options.spec?.semanticContext.status, evidenceCount: options.spec?.semanticContext.evidenceSourceIds.length })
  const validation = validateOfflineDashboard(html, options.privateTerms)
  if (!validation.valid) throw new Error(`DASHBOARD_VALIDATION_FAILED:${validation.issues.join(',')}`)
  const periods = model.trend.map((item) => item.period).sort()
  return { html, model, template, quality: { validRows: parsed.records.length, rejectedRows: parsed.rejectedRows, dateRange: { start: periods[0], end: periods.at(-1)! } } }
}
