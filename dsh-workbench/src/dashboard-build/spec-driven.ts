import type { DashboardSpec, MetricDefinition } from '../dashboard-agent/contracts.js'
import { parseTabularCsv } from '../data-ingestion/csv-profile.js'
import { validateOfflineDashboard } from '../dashboard-export/validator.js'
import type { BuildDashboardOptions } from './build.js'
import type { DashboardBuildResult, SpecDrivenDashboardModel } from './contracts.js'
import { createDraftManifest } from './manifest.js'
import { getDashboardTemplate } from './templates.js'
import { trustSectionHtml, visualContractCss } from './universal-contract.js'

type Row = Record<string, string>

const escape = (value: string | number) => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
const sum = (values: Array<number | undefined>): number => values.reduce<number>((total, value) => total + (value ?? 0), 0)
const number = (value: string | undefined): number | undefined => {
  if (!value?.trim()) return undefined
  const normalized = value.replace(/[¥￥$,\s]/g, '').replace(/%$/, '').replace(/^\((.*)\)$/, '-$1')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? (value.includes('%') ? parsed / 100 : parsed) : undefined
}
const fmt = (value: number | undefined, format: MetricDefinition['format']) => {
  if (value === undefined) return '待补充'
  if (format === 'percent') return `${(value * 100).toFixed(1)}%`
  if (format === 'currency') return `¥${Math.round(value).toLocaleString('zh-CN')}`
  if (format === 'duration') return `${value.toFixed(1)} 天`
  return Math.round(value).toLocaleString('zh-CN')
}

function mappedColumn(spec: DashboardSpec, dataset: { headers: string[] }, roleOrColumn: string): string | undefined {
  const column = spec.mapping[roleOrColumn] ?? roleOrColumn
  return dataset.headers.includes(column) ? column : undefined
}

function evaluate(expression: string, rows: Row[], spec: DashboardSpec, dataset: { headers: string[] }): number | undefined {
  const division = expression.match(/^(.+)\s*\/\s*(.+)$/)
  if (division) {
    const numerator = evaluate(division[1].trim(), rows, spec, dataset); const denominator = evaluate(division[2].trim(), rows, spec, dataset)
    return numerator === undefined || denominator === undefined || denominator === 0 ? undefined : numerator / denominator
  }
  const aggregate = expression.match(/^(LATEST_)?(SUM|AVG|COUNT|DISTINCT_COUNT|WEIGHTED_AVG|TOP5_SUM)\(([^)]+)\)$/)
  if (!aggregate) return undefined
  const [, latestSnapshot, functionName, fields] = aggregate
  const scopedRows = latestSnapshot ? latestRows(rows, spec, dataset) : rows
  const roles = fields.split(',').map(value => value.trim())
  const values = (role: string) => {
    const column = mappedColumn(spec, dataset, role)
    return column ? scopedRows.map(row => number(row[column])) : []
  }
  if (functionName === 'SUM') return sum(values(roles[0] ?? ''))
  if (functionName === 'AVG') { const available = values(roles[0] ?? '').filter((value): value is number => value !== undefined); return available.length ? sum(available) / available.length : undefined }
  if (functionName === 'COUNT') return scopedRows.length
  if (functionName === 'DISTINCT_COUNT') { const column = mappedColumn(spec, dataset, roles[0] ?? ''); return column ? new Set(scopedRows.map(row => row[column]).filter(Boolean)).size : undefined }
  if (functionName === 'TOP5_SUM') return sum(values(roles[0] ?? '').sort((left, right) => (right ?? 0) - (left ?? 0)).slice(0, 5))
  const numerator = values(roles[0] ?? ''); const weights = values(roles[1] ?? ''); const totalWeight = sum(weights)
  return totalWeight === 0 ? undefined : numerator.reduce<number>((total, value, index) => total + (value ?? 0) * (weights[index] ?? 0), 0) / totalWeight
}

/** Point-in-time inventory and coverage metrics must use the latest visible period, never a sum across snapshots. */
function latestRows(rows: Row[], spec: DashboardSpec, dataset: { headers: string[] }): Row[] {
  const period = mappedColumn(spec, dataset, spec.mapping.period ? 'period' : 'date')
  if (!period) return rows
  const latest = rows.map(row => row[period]?.trim() ?? '').filter(Boolean).sort((left, right) => left.localeCompare(right)).at(-1)
  return latest ? rows.filter(row => row[period]?.trim() === latest) : rows
}

function chartRows(spec: DashboardSpec, dataset: { headers: string[]; rows: Row[] }, chart: DashboardSpec['charts'][number], metrics: Map<string, MetricDefinition>) {
  const dimension = chart.dimensions[0] ?? ''
  const column = mappedColumn(spec, dataset, dimension)
  if (!column) return []
  const groups = new Map<string, Row[]>()
  for (const row of dataset.rows) { const label = row[column]?.trim() || '未分类'; groups.set(label, [...(groups.get(label) ?? []), row]) }
  const values = [...groups.entries()].map(([label, rows]) => ({ label, values: Object.fromEntries(chart.metrics.map(id => [id, metrics.has(id) ? evaluate(metrics.get(id)!.expression, rows, spec, dataset) : undefined])) }))
  const primary = chart.metrics[0]
  return values.sort((left, right) => chart.type === 'line'
    ? left.label.localeCompare(right.label)
    : (right.values[primary] ?? -Infinity) - (left.values[primary] ?? -Infinity)).slice(0, 30)
}

/** Evidence copy is generated from the rendered population, never from a static template sentence. */
function dataDiagnostics(spec: DashboardSpec, dataset: { headers: string[]; rows: Row[] }, values: Array<{ id: string; value: number | undefined }>): string[] {
  const period = mappedColumn(spec, dataset, 'period')
  const latest = latestRows(dataset.rows, spec, dataset)
  const latestPeriod = period ? latest[0]?.[period]?.trim() : undefined
  const messages = [latestPeriod ? `当前快照为 ${latestPeriod}，覆盖 ${latest.length.toLocaleString('zh-CN')} 条已映射记录。` : `当前视图覆盖 ${dataset.rows.length.toLocaleString('zh-CN')} 条已映射记录。`]
  const inventoryColumn = mappedColumn(spec, dataset, 'inventory')
  const segmentColumn = mappedColumn(spec, dataset, spec.mapping.region ? 'region' : spec.mapping.country ? 'country' : spec.mapping.item ? 'item' : '')
  if (inventoryColumn && segmentColumn && latest.length) {
    const totals = new Map<string, number>()
    for (const row of latest) totals.set(row[segmentColumn] || '未分类', (totals.get(row[segmentColumn] || '未分类') ?? 0) + (number(row[inventoryColumn]) ?? 0))
    const [leadingSegment, leadingInventory] = [...totals.entries()].sort((left, right) => right[1] - left[1])[0] ?? []
    const total = [...totals.values()].reduce((sum, value) => sum + value, 0)
    if (leadingSegment && total > 0) messages.push(`库存主要集中在 ${leadingSegment}，占当前库存 ${(leadingInventory / total * 100).toFixed(1)}%。`)
  }
  const dos = values.find(value => value.id === 'dos')?.value
  const targetDos = values.find(value => value.id === 'targetDos')?.value
  if (dos !== undefined && targetDos !== undefined) messages.push(`当前 DOS 为 ${dos.toFixed(1)} 天，目标为 ${targetDos.toFixed(1)} 天，差异 ${(dos - targetDos).toFixed(1)} 天。`)
  return messages
}

function createModel(spec: DashboardSpec, csv: string): { model: SpecDrivenDashboardModel; validRows: number; dateRange?: { start: string; end: string } } {
  const dataset = parseTabularCsv(csv)
  const missing = Object.values(spec.mapping).filter((column): column is string => Boolean(column)).filter(column => !dataset.headers.includes(column))
  if (missing.length) throw new Error(`MAPPING_COLUMNS_NOT_FOUND:${[...new Set(missing)].join(',')}`)
  const metricMap = new Map(spec.metrics.map(metric => [metric.id, metric]))
  const values = spec.metrics.map(metric => ({ id: metric.id, name: metric.name, value: evaluate(metric.expression, dataset.rows, spec, dataset), format: metric.format, expression: metric.expression }))
  const charts = spec.charts.map(chart => ({ id: chart.id, title: chart.title, type: chart.type, dimension: chart.dimensions[0] ?? '记录', metrics: chart.metrics, rows: chartRows(spec, dataset, chart, metricMap) }))
  const periodColumn = mappedColumn(spec, dataset, spec.mapping.period ? 'period' : 'date')
  const periods = periodColumn ? dataset.rows.map(row => row[periodColumn] ?? '').filter(Boolean).sort((left, right) => left.localeCompare(right)) : []
  const timeframe = periods.length ? `${periods[0]} 至 ${periods.at(-1)}` : `${dataset.rows.length} 条有效记录`
  const unavailable = values.filter(metric => metric.value === undefined).map(metric => metric.name)
  const conclusion = `已按确认的 ${values.length} 项指标和 ${charts.length} 个图表生成；${unavailable.length ? `待补充口径：${unavailable.join('、')}。` : '所有核心指标均可计算。'}`
  const detailColumns = [...new Set([...(spec.filters.map(filter => filter.field)), ...Object.values(spec.mapping).filter((column): column is string => Boolean(column))])].filter(column => dataset.headers.includes(column)).slice(0, 10)
  const filterColumns = [...new Set([...(spec.filters.map(filter => filter.field)), ...Object.values(spec.mapping).filter((column): column is string => Boolean(column))])].filter(column => dataset.headers.includes(column))
  const grain = [periodColumn, spec.filters.map(filter => filter.field).find(field => field !== periodColumn)].filter(Boolean).join(' × ') || '上传数据集'
  const diagnostics = unavailable.length
    ? [`无法按当前数据计算：${unavailable.join('、')}。请补充对应列或确认公式。`]
    : dataDiagnostics(spec, dataset, values)
  return { model: { kind: 'spec-driven-v1', title: spec.title, timeframe, freshness: new Date().toISOString(), conclusion, kpis: values, charts, detailColumns, detailRows: dataset.rows.slice(0, 30), filterRows: dataset.rows.map(row => Object.fromEntries(filterColumns.map(column => [column, row[column] ?? '']))), diagnostics, storylinePlan: spec.storylinePlan }, validRows: dataset.rows.length, ...(periods.length ? { dateRange: { start: periods[0], end: periods.at(-1)! } } : {}) }
}

/** Renders the adaptive SKU workbench from the confirmed page/module plan only. */
function renderAdaptiveSkuWorkspace(model: SpecDrivenDashboardModel, spec: DashboardSpec, options: BuildDashboardOptions, parts: {
  kpis: SpecDrivenDashboardModel['kpis']; bars: (chart: SpecDrivenDashboardModel['charts'][number] | undefined) => string; actions: string; header: string; rows: string; filterControls: string; interactiveScript: string
}): string {
  const chartById = new Map(model.charts.map(chart => [chart.id, chart]))
  const metricById = new Map(model.kpis.map(metric => [metric.id, metric]))
  const moduleHtml = (module: DashboardSpec['storylinePlan']['pages'][number]['modules'][number]) => {
    if (module.component === 'kpi-strip') {
      const metrics = (module.metricIds ?? []).map(id => metricById.get(id)).filter((item): item is SpecDrivenDashboardModel['kpis'][number] => Boolean(item))
      return `<div class="grid kpis">${metrics.map(metric => `<article class="card" data-dashboard-role="kpi"><div class="label">${escape(metric.name)}</div><div class="value" data-kpi="${escape(metric.id)}">${fmt(metric.value, metric.format)}</div><span class="hint">${escape(metric.expression)}</span></article>`).join('')}</div>`
    }
    if (module.component === 'chart') return `<div class="grid chart-grid">${(module.chartIds ?? []).map(id => chartById.get(id)).filter((chart): chart is SpecDrivenDashboardModel['charts'][number] => Boolean(chart)).map(chart => `<section class="chart-card chart-${escape(chart.type)}" data-dashboard-role="comparison"><h2>${escape(chart.title)}</h2><p class="hint">${escape(chartById.get(chart.id)?.type === 'line' ? '按时间序列查看变化。' : module.question)}</p><div data-chart-body="${escape(chart.id)}">${parts.bars(chart)}</div></section>`).join('')}</div>`
    if (module.component === 'diagnostic') return `<section data-dashboard-role="diagnostic" class="diagnostic"><h2>${escape(module.title)}</h2>${model.diagnostics.map(item => `<p>${escape(item)}</p>`).join('')}</section>`
    if (module.component === 'table') return `<section data-dashboard-role="detail"><h2>${escape(module.title)}</h2><div style="overflow:auto"><table><thead><tr>${parts.header}</tr></thead><tbody data-detail-body>${parts.rows}</tbody></table></div></section>`
    return `<section data-dashboard-role="actions"><h2>${escape(module.title)}</h2><div class="grid actions">${parts.actions}</div></section>`
  }
  const pages = spec.storylinePlan.pages.map((page, index) => `<article class="story-page" data-story-page="${escape(page.id)}"${index ? ' hidden' : ''}><header class="page-heading"><p class="eyebrow">${escape(page.purpose)}</p><h2>${escape(page.title)}</h2><p>${escape(page.readerQuestion)}</p></header>${page.modules.map(moduleHtml).join('')}</article>`).join('')
  const navigation = spec.storylinePlan.pages.length > 1 ? `<nav class="story-nav" aria-label="看板页面">${spec.storylinePlan.pages.map((page, index) => `<button type="button" data-story-tab="${escape(page.id)}"${index ? '' : ' class="active"'}>${escape(page.title)}</button>`).join('')}</nav>` : ''
  const omitted = spec.storylinePlan.omittedCapabilities.length ? `<section class="omitted"><h2>本次未启用的能力</h2>${spec.storylinePlan.omittedCapabilities.map(item => `<p><strong>${escape(item.capability)}：</strong>${escape(item.reason)}</p>`).join('')}</section>` : ''
  const tabs = `<script>document.querySelectorAll('[data-story-tab]').forEach(button=>button.addEventListener('click',()=>{const id=button.dataset.storyTab;document.querySelectorAll('[data-story-tab]').forEach(item=>item.classList.toggle('active',item===button));document.querySelectorAll('[data-story-page]').forEach(page=>page.hidden=page.dataset.storyPage!==id)}));</script>`
  const presentationCss = `<style>.hero .sub{max-width:720px;margin:8px 0}.hero .fresh{display:inline-flex;margin-top:12px;padding:3px 8px;border:1px solid #ffffff42;border-radius:999px}.filter-controls{padding:4px 0}.filter-controls label{min-width:168px}.filter-controls select{width:100%}.story-nav{position:sticky;top:0;z-index:2;padding:10px 0;background:var(--canvas)}.story-nav button{background:var(--surface);box-shadow:0 1px 2px #1018280d}.kpis{grid-template-columns:repeat(auto-fit,minmax(178px,1fr))}.card{position:relative;overflow:hidden;box-shadow:0 1px 2px #1018280a}.card:before{content:'';position:absolute;inset:0 auto 0 0;width:3px;background:var(--brand)}.value{font-variant-numeric:tabular-nums;letter-spacing:-.02em}.chart-card{min-height:280px;box-shadow:0 1px 2px #1018280a}.chart-card h2{font-size:16px}.chart-card .hint{min-height:38px}.chart-card .bar{padding:5px 0;margin:4px 0;border-bottom:1px solid color-mix(in srgb,var(--line) 65%,transparent)}.chart-card .bar:last-child{border-bottom:0}.chart-card .bar i{height:12px;background:linear-gradient(90deg,var(--brand),color-mix(in srgb,var(--brand) 62%,#8c9eff));box-shadow:inset 0 -1px #00000012}.chart-line .bar{grid-template-columns:118px 1fr 90px}.diagnostic{border-left-width:3px}.diagnostic p{margin:10px 0;padding-left:12px;position:relative}.diagnostic p:before{content:'•';position:absolute;left:0;color:var(--warn)}[data-dashboard-role="detail"]{padding:0;overflow:hidden}[data-dashboard-role="detail"] h2{padding:20px 20px 8px}th{position:sticky;top:46px;background:var(--surface);z-index:1}tbody tr:hover{background:var(--elevated)}.omitted{background:transparent!important;padding:14px 20px!important}@media(max-width:760px){.story-nav{overflow:auto;flex-wrap:nowrap}.story-nav button{white-space:nowrap}.filter-controls label{width:100%;min-width:0}.chart-card{min-height:0}.chart-line .bar{grid-template-columns:76px 1fr 78px}}</style>`
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(model.title)}</title><style>:root{--ink:#172033;--muted:#667085;--line:#dfe4ed;--brand:#3155c6;--soft:#edf2ff;--warn:#a36106}*{box-sizing:border-box}body{margin:0;background:#f4f6fa;color:var(--ink);font:14px/1.6 "Microsoft YaHei",Arial,sans-serif}.wrap{width:min(1240px,calc(100% - 32px));margin:auto}header.hero{padding:34px 0;background:linear-gradient(135deg,#1c2b63,#4264d7);color:#fff}h1{margin:0;font-size:30px}.sub,.fresh{color:#dce7ff}.fresh,.hint,.eyebrow{font-size:12px}.grid{display:grid;gap:16px}.kpis{grid-template-columns:repeat(3,1fr);margin-top:18px}.chart-grid{grid-template-columns:repeat(auto-fit,minmax(330px,1fr))}.actions{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}.card,section,.action{background:#fff;border:1px solid var(--line);border-radius:12px;padding:20px}main{padding:26px 0 60px}section{margin-top:18px}h2{font-size:18px;margin:0 0 8px}.page-heading{margin-top:24px}.page-heading h2{font-size:24px}.page-heading p{margin:0;color:var(--muted)}.eyebrow{text-transform:uppercase;letter-spacing:.08em;color:var(--brand);font-weight:700}.label,.hint{color:var(--muted)}.value{font-size:27px;font-weight:700;margin:6px 0}.filter-controls,.story-nav{display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin-top:12px}.filter-controls label{display:grid;gap:5px;font-size:12px;color:var(--muted)}select,button{font:inherit}select{min-width:150px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink)}button{padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--soft);color:var(--brand);cursor:pointer}.story-nav button.active{background:var(--brand);border-color:var(--brand);color:#fff}.bar{display:grid;grid-template-columns:94px 1fr 120px;gap:10px;align-items:center;margin:12px 0}.bar i{height:10px;display:block;background:var(--brand);border-radius:99px}.diagnostic{border-left:4px solid var(--warn);background:#fff9eb}.action b{color:var(--warn)}table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}th{font-size:12px;color:var(--muted)}.omitted{border-style:dashed;color:var(--muted)}@media(max-width:760px){.kpis,.chart-grid,.actions{grid-template-columns:1fr}.bar{grid-template-columns:70px 1fr 90px}}</style></head><body><header class="hero" data-dashboard-role="summary" data-freshness="${escape(model.freshness)}"><div class="wrap"><h1>${escape(model.title)}</h1><p class="sub">${escape(model.timeframe)} · ${escape(spec.storylinePlan.primaryQuestion)}</p><span class="fresh">数据更新至 ${escape(model.freshness.replace('T', ' ').slice(0, 19))}</span></div></header><main class="wrap" data-dashboard-adaptive="true"><section data-dashboard-role="filters"><strong>查看范围</strong><div class="filter-controls">${parts.filterControls}<button type="button" data-filter-reset>重置筛选</button></div><p class="hint" data-filter-result>当前筛选命中 ${model.filterRows.length.toLocaleString('zh-CN')} 条记录</p></section>${navigation}${pages}${omitted}${trustSectionHtml({ sourceLabel: options.sourceLabel, freshness: model.freshness, semanticStatus: spec.semanticContext.status, evidenceCount: spec.semanticContext.evidenceSourceIds.length })}</main>${visualContractCss(spec.visualContract)}${presentationCss}${tabs}${parts.interactiveScript}</body></html>`
}

function render(model: SpecDrivenDashboardModel, spec: DashboardSpec, options: BuildDashboardOptions): string {
  const kpis = model.kpis.slice(0, 6)
  const trend = model.charts.find(chart => chart.type === 'line') ?? model.charts[0]
  const supportingCharts = model.charts.filter(chart => chart.id !== trend?.id && chart.type !== 'table')
  const bars = (chart: SpecDrivenDashboardModel['charts'][number] | undefined) => {
    if (!chart?.rows.length) return '<p class="hint">当前没有可展示的分组数据。</p>'
    const metric = chart.metrics[0]; const maximum = Math.max(...chart.rows.map(row => Math.abs(row.values[metric] ?? 0)), 1)
    return chart.rows.slice(0, 12).map(row => `<div class="bar"><span>${escape(row.label)}</span><i style="width:${Math.max(2, Math.abs(row.values[metric] ?? 0) / maximum * 100)}%"></i><b>${fmt(row.values[metric], spec.metrics.find(item => item.id === metric)?.format ?? 'number')}</b></div>`).join('')
  }
  const actions = (spec.intent.decisions.length ? spec.intent.decisions : ['复核主要变化和异常分组', '确认需要下钻的业务维度', '根据看板结论安排后续动作']).slice(0, 3).map((decision, index) => `<article class="action"><b>${index === 0 ? '高' : '中'}优先级</b><p><strong>待决策：</strong>${escape(decision)}</p><p><strong>依据：</strong>${escape(model.conclusion)}</p></article>`).join('')
  const header = model.detailColumns.map(column => `<th>${escape(column)}</th>`).join('')
  const rows = model.detailRows.map(row => `<tr>${model.detailColumns.map(column => `<td>${escape(row[column] ?? '')}</td>`).join('')}</tr>`).join('')
  const filterControls = spec.filters.map(filter => {
    const options = [...new Set(model.filterRows.map(row => row[filter.field]).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'zh-CN')).map(value => `<option value="${escape(value)}">${escape(value)}</option>`).join('')
    return `<label>${escape(filter.label)}<select data-filter-field="${escape(filter.field)}"><option value="">全部</option>${options}</select></label>`
  }).join('')
  const payload = JSON.stringify({ rows: model.filterRows, spec: { mapping: spec.mapping, metrics: spec.metrics, charts: spec.charts }, detailColumns: model.detailColumns }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  const interactiveScript = `<script>const dashboardData=${payload};(()=>{const d=dashboardData,esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),col=r=>d.spec.mapping[r]||r,num=v=>{const n=Number(String(v??'').replace(/[¥￥$,\\s]/g,''));return Number.isFinite(n)?n:undefined},sum=a=>a.reduce((t,v)=>t+(v??0),0),latest=rows=>{const p=col('period');const value=rows.map(r=>r[p]||'').filter(Boolean).sort().at(-1);return value?rows.filter(r=>r[p]===value):rows},evalExpr=(expr,rows)=>{const slash=expr.indexOf(' / ');if(slash>0){const a=evalExpr(expr.slice(0,slash),rows),b=evalExpr(expr.slice(slash+3),rows);return a===undefined||b===undefined||b===0?undefined:a/b}const match=/^(LATEST_)?(SUM|AVG|COUNT|DISTINCT_COUNT|WEIGHTED_AVG|TOP5_SUM)\\(([^)]+)\\)$/.exec(expr);if(!match)return undefined;const scoped=match[1]?latest(rows):rows,roles=match[3].split(',').map(x=>x.trim()),values=role=>scoped.map(r=>num(r[col(role)]));if(match[2]==='SUM')return sum(values(roles[0]));if(match[2]==='AVG'){const a=values(roles[0]).filter(v=>v!==undefined);return a.length?sum(a)/a.length:undefined}if(match[2]==='COUNT')return scoped.length;if(match[2]==='DISTINCT_COUNT')return new Set(scoped.map(r=>r[col(roles[0])]).filter(Boolean)).size;if(match[2]==='TOP5_SUM')return sum(values(roles[0]).sort((a,b)=>(b??0)-(a??0)).slice(0,5));const n=values(roles[0]),w=values(roles[1]),total=sum(w);return total===0?undefined:n.reduce((t,v,i)=>t+(v??0)*(w[i]??0),0)/total},format=(value,kind)=>value===undefined?'待补充':kind==='percent'?(value*100).toFixed(1)+'%':kind==='currency'?'¥'+Math.round(value).toLocaleString('zh-CN'):kind==='duration'?value.toFixed(1)+' 天':Math.round(value).toLocaleString('zh-CN'),chartRows=(chart,rows)=>{const field=col(chart.dimensions[0]||''),groups={};rows.forEach(r=>{const key=r[field]||'未分类';(groups[key]??=[]).push(r)});const primary=chart.metrics[0],result=[];Object.entries(groups).forEach(([label,items])=>{const values={};chart.metrics.forEach(id=>{const metric=d.spec.metrics.find(m=>m.id===id);values[id]=metric?evalExpr(metric.expression,items):undefined});result.push({label,values})});return result.sort((a,b)=>chart.type==='line'?a.label.localeCompare(b.label):(b.values[primary]??-Infinity)-(a.values[primary]??-Infinity)).slice(0,12)},bars=(chart,rows)=>{if(!chart)return '<p class="hint">当前没有可展示的分组数据。</p>';const metric=d.spec.metrics.find(m=>m.id===chart.metrics[0]),items=chartRows(chart,rows),max=Math.max(...items.map(x=>Math.abs(x.values[chart.metrics[0]]??0)),1);return items.map(x=>'<div class="bar"><span>'+esc(x.label)+'</span><i style="width:'+Math.max(2,Math.abs(x.values[chart.metrics[0]]??0)/max*100)+'%"></i><b>'+format(x.values[chart.metrics[0]],metric?.format||'number')+'</b></div>').join('')},update=()=>{const selected=[];document.querySelectorAll('[data-filter-field]').forEach(e=>selected.push([e.dataset.filterField,e.value]));const rows=d.rows.filter(r=>selected.every(([field,value])=>!value||r[field]===value));d.spec.metrics.slice(0,6).forEach(metric=>{const el=document.querySelector('[data-kpi="'+metric.id+'"]');if(el)el.textContent=format(evalExpr(metric.expression,rows),metric.format)});d.spec.charts.forEach(chart=>{const el=document.querySelector('[data-chart-body="'+chart.id+'"]');if(el)el.innerHTML=bars(chart,rows)});const body=document.querySelector('[data-detail-body]');if(body)body.innerHTML=rows.slice(0,30).map(r=>'<tr>'+d.detailColumns.map(c=>'<td>'+esc(r[c]||'')+'</td>').join('')+'</tr>').join('');const result=document.querySelector('[data-filter-result]');if(result)result.textContent='当前筛选命中 '+rows.length.toLocaleString('zh-CN')+' / '+d.rows.length.toLocaleString('zh-CN')+' 条记录'};document.querySelectorAll('[data-filter-field]').forEach(el=>el.addEventListener('change',update));document.querySelector('[data-filter-reset]')?.addEventListener('click',()=>{document.querySelectorAll('[data-filter-field]').forEach(el=>el.value='');update()});update()})();</script>`
  if (spec.templateId === 'sku-operations-v1') return renderAdaptiveSkuWorkspace(model, spec, options, { kpis, bars, actions, header, rows, filterControls, interactiveScript })
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(model.title)}</title><style>:root{--ink:#172033;--muted:#667085;--line:#dfe4ed;--brand:#3155c6;--soft:#edf2ff;--warn:#a36106}*{box-sizing:border-box}body{margin:0;background:#f4f6fa;color:var(--ink);font:14px/1.6 "Microsoft YaHei",Arial,sans-serif}.wrap{width:min(1180px,calc(100% - 32px));margin:auto}header{padding:36px 0;background:linear-gradient(135deg,#1c2b63,#4264d7);color:#fff}h1{margin:0;font-size:30px}.sub,.fresh{color:#dce7ff}.fresh,.hint{font-size:12px}.grid{display:grid;gap:16px}.kpis{grid-template-columns:repeat(3,1fr);margin-top:-22px}.two,.actions{grid-template-columns:1.2fr .8fr}.card,section,.action{background:#fff;border:1px solid var(--line);border-radius:12px;padding:20px}main{padding:34px 0 60px}section{margin-top:18px}h2{font-size:18px;margin:0 0 14px}.label,.hint{color:var(--muted)}.value{font-size:27px;font-weight:700;margin:6px 0}.filter-controls{display:flex;flex-wrap:wrap;gap:12px;align-items:end;margin-top:12px}.filter-controls label{display:grid;gap:5px;font-size:12px;color:var(--muted)}select,button{font:inherit}select{min-width:150px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink)}button{padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--soft);color:var(--brand);cursor:pointer}.bar{display:grid;grid-template-columns:94px 1fr 120px;gap:10px;align-items:center;margin:12px 0}.bar i{height:10px;display:block;background:var(--brand);border-radius:99px}.diagnostic{border-left:4px solid var(--warn);background:#fff9eb}.action b{color:var(--warn)}table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}th{font-size:12px;color:var(--muted)}@media(max-width:760px){.kpis,.two,.actions{grid-template-columns:1fr}.kpis{margin-top:16px}.bar{grid-template-columns:70px 1fr 90px}}</style></head><body><header data-dashboard-role="summary" data-freshness="${escape(model.freshness)}"><div class="wrap"><h1>${escape(model.title)}</h1><p class="sub">${escape(model.timeframe)} · ${escape(model.conclusion)}</p><span class="fresh">数据更新至 ${escape(model.freshness.replace('T', ' ').slice(0, 19))}</span></div></header><main class="wrap"><section data-dashboard-role="filters"><strong>查看范围</strong><div class="filter-controls">${filterControls}<button type="button" data-filter-reset>重置筛选</button></div><p class="hint" data-filter-result>当前筛选命中 ${model.filterRows.length.toLocaleString('zh-CN')} 条记录</p></section><div class="grid kpis">${kpis.map(metric => `<article class="card" data-dashboard-role="kpi"><div class="label">${escape(metric.name)}</div><div class="value" data-kpi="${escape(metric.id)}">${fmt(metric.value, metric.format)}</div><span class="hint">${escape(metric.expression)}</span></article>`).join('')}</div><div class="grid two"><section data-dashboard-role="trend"><h2>${escape(trend?.title ?? '核心趋势')}</h2><div data-chart-body="${escape(trend?.id ?? '')}">${bars(trend)}</div></section><section data-dashboard-role="diagnostic" class="diagnostic"><h2>数据诊断</h2>${model.diagnostics.map(item => `<p>${escape(item)}</p>`).join('')}</section></div><div class="grid two">${supportingCharts.map(chart => `<section data-dashboard-role="comparison"><h2>${escape(chart.title)}</h2><div data-chart-body="${escape(chart.id)}">${bars(chart)}</div></section>`).join('')}</div><section data-dashboard-role="actions"><h2>建议行动</h2><div class="grid actions">${actions}</div></section><section data-dashboard-role="detail"><h2>已映射明细</h2><div style="overflow:auto"><table><thead><tr>${header}</tr></thead><tbody data-detail-body>${rows}</tbody></table></div></section>${trustSectionHtml({ sourceLabel: options.sourceLabel, freshness: model.freshness, semanticStatus: spec.semanticContext.status, evidenceCount: spec.semanticContext.evidenceSourceIds.length })}</main>${visualContractCss(spec.visualContract)}${interactiveScript}</body></html>`
}

export function buildSpecDrivenDashboardFromCsv(csv: string, options: BuildDashboardOptions & { spec: DashboardSpec }): DashboardBuildResult<SpecDrivenDashboardModel> {
  const { model, validRows, dateRange } = createModel(options.spec, csv)
  const html = render(model, options.spec, options)
  const validation = validateOfflineDashboard(html, options.privateTerms)
  if (!validation.valid) throw new Error(`DASHBOARD_VALIDATION_FAILED:${validation.issues.join(',')}`)
  const template = getDashboardTemplate(options.spec.templateId)
  return { html, model, template, manifest: createDraftManifest(options, template, options.previousManifest), quality: { validRows, rejectedRows: [], dateRange } }
}
