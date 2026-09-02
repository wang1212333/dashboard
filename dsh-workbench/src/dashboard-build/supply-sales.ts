import { validateOfflineDashboard } from '../dashboard-export/validator.js'
import { parseTabularCsv, type DashboardFieldMapping } from '../data-ingestion/csv-profile.js'
import type { DashboardBuildResult, SupplySalesDashboardModel } from './contracts.js'
import { createDraftManifest } from './manifest.js'
import type { BuildDashboardOptions } from './build.js'
import { getDashboardTemplate } from './templates.js'
import { applyUniversalDashboardContract } from './universal-contract.js'

interface SupplySalesRecord { period: string; country: string; region: string; forecast: number; shipments: number; sellIn: number; sellOut: number; inventory: number; dos?: number; targetDos?: number }
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
const ratio = (value: number, base: number) => base === 0 ? 0 : value / base
const safe = (value: string | number) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
const number = (value: string | undefined, field: string, optional = false): number | undefined => {
  if (!value?.trim()) { if (optional) return undefined; return 0 }
  const parsed = Number(value.replace(/[¥￥$, \s]/g, '').replace(/^\((.*)\)$/, '-$1'))
  if (!Number.isFinite(parsed)) throw new Error(`SUPPLY_SALES_NUMBER_INVALID:${field}`)
  return parsed
}
const mapped = (row: Record<string, string>, mapping: DashboardFieldMapping, role: string) => mapping[role] ? row[mapping[role]!] : undefined

function parseRecords(csv: string, mapping: DashboardFieldMapping): { records: SupplySalesRecord[]; rejectedRows: Array<{ row: number; reason: string }> } {
  const dataset = parseTabularCsv(csv)
  const required = ['period', 'country', 'forecast', 'shipments', 'sellIn', 'sellOut', 'inventory']
  const missing = required.filter((role) => !mapping[role] || !dataset.headers.includes(mapping[role]!))
  if (missing.length) throw new Error(`MAPPING_REQUIRED:${missing.join(',')}`)
  const records: SupplySalesRecord[] = []; const rejectedRows: Array<{ row: number; reason: string }> = []
  dataset.rows.forEach((row, index) => {
    try {
      const period = mapped(row, mapping, 'period')?.trim(); const country = mapped(row, mapping, 'country')?.trim()
      if (!period) throw new Error('PERIOD_REQUIRED'); if (!country) throw new Error('COUNTRY_REQUIRED')
      records.push({ period, country, region: mapped(row, mapping, 'region')?.trim() || '未分配区域', forecast: number(mapped(row, mapping, 'forecast'), 'forecast')!, shipments: number(mapped(row, mapping, 'shipments'), 'shipments')!, sellIn: number(mapped(row, mapping, 'sellIn'), 'sellIn')!, sellOut: number(mapped(row, mapping, 'sellOut'), 'sellOut')!, inventory: number(mapped(row, mapping, 'inventory'), 'inventory')!, dos: number(mapped(row, mapping, 'dos'), 'dos', true), targetDos: number(mapped(row, mapping, 'targetDos'), 'targetDos', true) })
    } catch (error) { rejectedRows.push({ row: index + 2, reason: error instanceof Error ? error.message : 'INVALID_ROW' }) }
  })
  if (!records.length) throw new Error('SUPPLY_SALES_HAS_NO_VALID_RECORDS')
  return { records, rejectedRows }
}

function weightedAverage(items: SupplySalesRecord[], field: 'dos' | 'targetDos'): number | undefined {
  const available = items.filter(item => item[field] !== undefined)
  const weight = sum(available.map(item => item.inventory))
  return weight > 0 ? sum(available.map(item => item[field]! * item.inventory)) / weight : undefined
}

function createModel(records: SupplySalesRecord[]): SupplySalesDashboardModel {
  const byPeriod = new Map<string, SupplySalesRecord[]>(); const byCountry = new Map<string, SupplySalesRecord[]>(); const byRegion = new Map<string, SupplySalesRecord[]>()
  for (const record of records) { byPeriod.set(record.period, [...(byPeriod.get(record.period) ?? []), record]); byCountry.set(record.country, [...(byCountry.get(record.country) ?? []), record]); byRegion.set(record.region, [...(byRegion.get(record.region) ?? []), record]) }
  const trend = [...byPeriod.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, items]) => ({ period, forecast: sum(items.map(x => x.forecast)), shipments: sum(items.map(x => x.shipments)), sellIn: sum(items.map(x => x.sellIn)), sellOut: sum(items.map(x => x.sellOut)) }))
  const snapshotPeriod = trend.at(-1)!.period
  const snapshot = records.filter(x => x.period === snapshotPeriod)
  // Inventory and DOS are point-in-time measures: use the latest available snapshot, never a sum across months.
  const inventoryDos = weightedAverage(snapshot, 'dos')
  const targetDos = weightedAverage(snapshot, 'targetDos')
  const inventory = sum(snapshot.map(x => x.inventory))
  const kpis = { forecast: sum(records.map(x => x.forecast)), shipments: sum(records.map(x => x.shipments)), sellIn: sum(records.map(x => x.sellIn)), sellOut: sum(records.map(x => x.sellOut)), inventory, inventoryDos, targetDos, dosToTarget: inventoryDos === undefined || targetDos === undefined ? undefined : ratio(inventoryDos, targetDos), shipmentFulfillment: ratio(sum(records.map(x => x.shipments)), sum(records.map(x => x.forecast))), inventoryConcentration: ratio(sum([...snapshot].sort((left, right) => right.inventory - left.inventory).slice(0, 5).map(x => x.inventory)), inventory) }
  const countries = [...byCountry.entries()].map(([country, items]) => {
    const latest = [...items].sort((a, b) => a.period.localeCompare(b.period)).at(-1)!.period
    const snapshotItems = items.filter(x => x.period === latest)
    const inventory = sum(snapshotItems.map(x => x.inventory))
    const dos = weightedAverage(snapshotItems, 'dos'); const targetDos = weightedAverage(snapshotItems, 'targetDos')
    return { country, region: snapshotItems[0]?.region ?? '未分配区域', sellIn: sum(snapshotItems.map(x => x.sellIn)), sellOut: sum(snapshotItems.map(x => x.sellOut)), inventory, dos, targetDos, dosToTarget: dos === undefined || targetDos === undefined ? undefined : ratio(dos, targetDos), forecastAchievement: ratio(sum(snapshotItems.map(x => x.sellOut)), sum(snapshotItems.map(x => x.forecast))) }
  }).sort((a, b) => b.inventory - a.inventory)
  const regions = [...byRegion.entries()].map(([region, items]) => {
    const latest = [...items].sort((a, b) => a.period.localeCompare(b.period)).at(-1)!.period
    const snapshotItems = items.filter(item => item.period === latest)
    const dos = weightedAverage(snapshotItems, 'dos'); const targetDos = weightedAverage(snapshotItems, 'targetDos')
    return { region, inventory: sum(snapshotItems.map(item => item.inventory)), sellOut: sum(snapshotItems.map(item => item.sellOut)), dos, targetDos, dosToTarget: dos === undefined || targetDos === undefined ? undefined : ratio(dos, targetDos) }
  }).sort((a, b) => b.inventory - a.inventory)
  const highestRisk = countries.filter(x => x.dos !== undefined).sort((a, b) => b.dos! - a.dos!)[0]
  const achievement = ratio(kpis.sellOut, kpis.forecast)
  return { kind: 'supply-sales-v1', timeframe: `${trend[0].period} 至 ${trend.at(-1)!.period}`, snapshotPeriod, freshness: new Date().toISOString(), conclusion: `累计 SO ${Math.round(kpis.sellOut).toLocaleString('zh-CN')}，发货满足率 ${(kpis.shipmentFulfillment * 100).toFixed(1)}%。`, kpis, trend, countries, regions, diagnostic: highestRisk ? `${highestRisk.country} 最新可用月份的渠道 DOS 为 ${highestRisk.dos!.toFixed(1)} 天，且库存 ${Math.round(highestRisk.inventory).toLocaleString('zh-CN')}，应优先核对去化节奏。` : '没有可用的 DOS 数据，暂按库存规模进行风险排序。', actions: [{ priority: achievement < .8 ? '高' : '中', evidence: `SO / DRP2 为 ${(achievement * 100).toFixed(1)}%`, nextStep: '按国家与项目拆解预测缺口，校准滚动预测。', expectedDirection: '提升销售达成' }, { priority: '高', evidence: highestRisk ? `${highestRisk.country} DOS ${highestRisk.dos!.toFixed(1)} 天` : 'DOS 缺失', nextStep: highestRisk ? `针对 ${highestRisk.country} 复核补货与促销节奏。` : '补齐国家级 DOS 数据后再做库存预警。', expectedDirection: '降低库存风险' }, { priority: '中', evidence: `SAP 发货 / DRP2 为 ${(ratio(kpis.shipments, kpis.forecast) * 100).toFixed(1)}%`, nextStep: '复核发货、SI 与 SO 的节奏差异。', expectedDirection: '改善供销协同' }] }
}

const fmt = (value: number) => Math.round(value).toLocaleString('zh-CN')
const pct = (value: number | undefined) => value === undefined ? '待补充' : `${(value * 100).toFixed(1)}%`
const days = (value: number | undefined) => value === undefined ? '待补充' : `${value.toFixed(1)} 天`
const palette = ['#3155c6', '#087e65', '#a36106', '#7f56d9', '#d14c8b', '#237b9e', '#5b6b7a']

function donut(regions: SupplySalesDashboardModel['regions']): string {
  const visible = regions.slice(0, 7); const total = sum(visible.map(region => region.inventory))
  if (total <= 0) return '<p class="hint">暂无可用库存结构数据。</p>'
  let progress = 0
  const stops = visible.map((region, index) => {
    const start = progress; progress += region.inventory / total * 100
    return `${palette[index % palette.length]} ${start.toFixed(2)}% ${progress.toFixed(2)}%`
  }).join(',')
  const legend = visible.map((region, index) => `<li><i style="background:${palette[index % palette.length]}"></i>${safe(region.region)} <b>${pct(ratio(region.inventory, total))}</b></li>`).join('')
  return `<div class="donut-layout"><div class="donut" style="background:conic-gradient(${stops})"><span>库存<br><b>${fmt(total)}</b></span></div><ul class="legend">${legend}</ul></div>`
}

function scatter(countries: SupplySalesDashboardModel['countries']): string {
  const points = countries.filter(country => country.dos !== undefined && country.targetDos !== undefined).slice(0, 24)
  if (!points.length) return '<p class="hint">需补充国家级 DOS 与目标 DOS 后显示对比。</p>'
  const max = Math.max(...points.flatMap(country => [country.dos!, country.targetDos!]), 1)
  const circles = points.map((country, index) => {
    const x = 42 + country.targetDos! / max * 236; const y = 176 - country.dos! / max * 136
    const color = country.dosToTarget !== undefined && country.dosToTarget > 1 ? '#b42318' : '#087e65'
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${Math.max(4, Math.min(11, 4 + Math.sqrt(country.inventory) / 70)).toFixed(1)}" fill="${color}" fill-opacity=".75"><title>${safe(`${country.country}：DOS ${days(country.dos)}，目标 ${days(country.targetDos)}`)}</title></circle>`
  }).join('')
  return `<svg class="scatter" viewBox="0 0 320 210" role="img" aria-label="国家 DOS 与目标 DOS 对比散点图"><line x1="42" y1="176" x2="286" y2="176"></line><line x1="42" y1="24" x2="42" y2="176"></line><line x1="42" y1="176" x2="286" y2="24" class="target-line"></line><text x="250" y="202">目标 DOS →</text><text x="8" y="24">DOS ↑</text>${circles}</svg><p class="hint"><i class="dot good"></i> 达标/低于目标 <i class="dot bad"></i> 高于目标；点面积代表库存。</p>`
}

function render(model: SupplySalesDashboardModel): string {
  const maximum = Math.max(...model.trend.flatMap(x => [x.forecast, x.shipments, x.sellIn, x.sellOut]), 1)
  const bars = model.trend.map(x => `<div class="bar"><span>${safe(x.period)}</span><i style="width:${Math.max(2, x.sellOut / maximum * 100)}%"></i><b>SO ${fmt(x.sellOut)}</b></div>`).join('')
  const rows = model.countries.slice(0, 20).map(x => `<tr><td>${safe(x.region)}</td><td>${safe(x.country)}</td><td>${fmt(x.sellIn)}</td><td>${fmt(x.sellOut)}</td><td>${fmt(x.inventory)}</td><td>${days(x.dos)}</td><td>${days(x.targetDos)}</td><td>${pct(x.dosToTarget)}</td><td>${pct(x.forecastAchievement)}</td></tr>`).join('')
  const regionRows = model.regions.map(x => `<tr><td>${safe(x.region)}</td><td>${fmt(x.inventory)}</td><td>${fmt(x.sellOut)}</td><td>${days(x.dos)}</td><td>${days(x.targetDos)}</td><td>${pct(x.dosToTarget)}</td></tr>`).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>产销协同驾驶舱</title><style>:root{--ink:#172033;--muted:#667085;--line:#dfe4ed;--brand:#3757c5;--soft:#eef2ff;--warn:#a36106;--danger:#b42318;--good:#087e65}*{box-sizing:border-box}body{margin:0;background:#f4f6fa;color:var(--ink);font:14px/1.6 "Microsoft YaHei",Arial,sans-serif}.wrap{width:min(1180px,calc(100% - 32px));margin:auto}header{padding:36px 0;background:linear-gradient(135deg,#1c2b63,#4264d7);color:#fff}h1{margin:0;font-size:30px}.sub{color:#e1e8ff;margin:8px 0}.fresh,.hint{font-size:12px;color:var(--muted)}.fresh{color:#ced8ff}.grid{display:grid;gap:16px}.kpis{grid-template-columns:repeat(3,1fr);margin-top:-22px}.health{grid-template-columns:repeat(4,1fr)}.card,section,.action{background:#fff;border:1px solid var(--line);border-radius:12px;padding:20px}.label{font-size:12px;color:var(--muted)}.value{font-size:27px;font-weight:700;margin:6px 0}main{padding:34px 0 60px}section{margin-top:18px}h2{font-size:18px;margin:0 0 14px}.two{grid-template-columns:1.2fr .8fr}.bar{display:grid;grid-template-columns:82px 1fr 110px;gap:10px;align-items:center;margin:12px 0}.bar i{height:10px;display:block;background:var(--brand);border-radius:99px}.diagnostic{border-left:4px solid #c4882b;background:#fff9eb}.actions{grid-template-columns:repeat(3,1fr)}.action b{color:var(--warn)}table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}th{font-size:12px;color:var(--muted)}.donut-layout{display:flex;gap:24px;align-items:center}.donut{width:170px;height:170px;border-radius:50%;display:grid;place-items:center;flex:0 0 auto}.donut span{width:102px;height:102px;border-radius:50%;display:grid;place-content:center;text-align:center;background:#fff;font-size:12px;color:var(--muted);line-height:1.3}.donut b{font-size:17px;color:var(--ink)}.legend{list-style:none;padding:0;margin:0;display:grid;gap:8px}.legend i,.dot{width:10px;height:10px;border-radius:50%;display:inline-block;margin-right:7px}.legend b{margin-left:8px}.scatter{width:100%;max-width:360px;height:auto}.scatter line{stroke:var(--line);stroke-width:1}.scatter .target-line{stroke:var(--warn);stroke-dasharray:4 4}.scatter text{font-size:10px;fill:var(--muted)}.dot.good{background:var(--good)}.dot.bad{background:var(--danger)}@media(max-width:760px){.kpis,.health,.two,.actions{grid-template-columns:1fr}.kpis{margin-top:16px}.bar{grid-template-columns:70px 1fr 86px}.donut-layout{align-items:flex-start;flex-direction:column}}</style></head><body><header data-dashboard-role="summary" data-freshness="${safe(model.freshness)}"><div class="wrap"><h1>产销协同驾驶舱</h1><p class="sub">${safe(model.timeframe)} · ${safe(model.conclusion)}</p><span class="fresh">数据更新至 ${safe(model.freshness.replace('T',' ').slice(0,19))}</span></div></header><main class="wrap"><section data-dashboard-role="filters"><strong>查看范围</strong><span class="hint"> ${safe(model.timeframe)} · 按地区部、国家与周期查看</span></section><div class="grid kpis"><article class="card" data-dashboard-role="kpi"><div class="label">预测</div><div class="value">${fmt(model.kpis.forecast)}</div></article><article class="card" data-dashboard-role="kpi"><div class="label">发货</div><div class="value">${fmt(model.kpis.shipments)}</div></article><article class="card" data-dashboard-role="kpi"><div class="label">进货</div><div class="value">${fmt(model.kpis.sellIn)}</div></article><article class="card" data-dashboard-role="kpi"><div class="label">销售出库</div><div class="value">${fmt(model.kpis.sellOut)}</div></article><article class="card" data-dashboard-role="kpi"><div class="label">全渠道库存（${safe(model.snapshotPeriod)}）</div><div class="value">${fmt(model.kpis.inventory)}</div></article><article class="card" data-dashboard-role="kpi"><div class="label">库存加权 DOS</div><div class="value">${days(model.kpis.inventoryDos)}</div></article></div><section><h2>经营健康度</h2><div class="grid health"><article class="card"><div class="label">目标 DOS</div><div class="value">${days(model.kpis.targetDos)}</div></article><article class="card"><div class="label">DOS / 目标 DOS</div><div class="value">${pct(model.kpis.dosToTarget)}</div></article><article class="card"><div class="label">发货满足率</div><div class="value">${pct(model.kpis.shipmentFulfillment)}</div></article><article class="card"><div class="label">库存集中度（Top 5）</div><div class="value">${pct(model.kpis.inventoryConcentration)}</div></article></div></section><div class="grid two"><section data-dashboard-role="trend"><h2>周期 SO 趋势</h2>${bars}<p class="hint">柱形长度按周期 SO 相对最大值显示。</p></section><section data-dashboard-role="diagnostic" class="diagnostic"><h2>库存风险诊断</h2><p>${safe(model.diagnostic)}</p></section></div><div class="grid two"><section data-dashboard-role="comparison"><h2>地区库存占比</h2>${donut(model.regions)}</section><section><h2>DOS 与目标对比</h2>${scatter(model.countries)}</section></div><section><h2>地区部库存与 DOS</h2><div style="overflow:auto"><table><thead><tr><th>地区部</th><th>库存</th><th>SO</th><th>DOS</th><th>目标 DOS</th><th>DOS / 目标</th></tr></thead><tbody>${regionRows}</tbody></table></div></section><section data-dashboard-role="actions"><h2>建议行动</h2><div class="grid actions">${model.actions.map(x => `<article class="action"><b>${x.priority}优先级</b><p><strong>证据：</strong>${safe(x.evidence)}</p><p><strong>下一步：</strong>${safe(x.nextStep)}</p><p><strong>预期：</strong>${safe(x.expectedDirection)}</p></article>`).join('')}</div></section><section data-dashboard-role="detail"><h2>国家库存行动明细（各国家最新周期，按库存排序）</h2><div style="overflow:auto"><table><thead><tr><th>地区部</th><th>国家</th><th>SI</th><th>SO</th><th>库存</th><th>DOS</th><th>目标 DOS</th><th>DOS / 目标</th><th>SO / 预测</th></tr></thead><tbody>${rows}</tbody></table></div></section></main></body></html>`
}

export function buildSupplySalesDashboardFromCsv(csv: string, options: BuildDashboardOptions): DashboardBuildResult {
  const template = getDashboardTemplate('supply-sales-v1'); const parsed = parseRecords(csv, options.mapping ?? {}); const model = createModel(parsed.records); const html = applyUniversalDashboardContract(render(model), { visualContract: options.spec?.visualContract, sourceLabel: options.sourceLabel, freshness: model.freshness, semanticStatus: options.spec?.semanticContext.status, evidenceCount: options.spec?.semanticContext.evidenceSourceIds.length }); const validation = validateOfflineDashboard(html, options.privateTerms)
  if (!validation.valid) throw new Error(`DASHBOARD_VALIDATION_FAILED:${validation.issues.join(',')}`)
  const periods = model.trend.map(x => x.period).sort()
  return { html, model, template, manifest: createDraftManifest(options, template, options.previousManifest), quality: { validRows: parsed.records.length, rejectedRows: parsed.rejectedRows, dateRange: { start: periods[0], end: periods.at(-1)! } } }
}
