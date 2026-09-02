import type { CategoryMetric, ContentDashboardModel, ContentRecord } from './contracts.js'

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
const percent = (numerator: number, denominator: number) => denominator === 0 ? 0 : numerator / denominator

export function createDashboardModel(records: ContentRecord[]): ContentDashboardModel {
  const planned = sum(records.map((record) => record.planned))
  const published = sum(records.map((record) => record.published))
  const views = sum(records.map((record) => record.views))
  const conversions = sum(records.map((record) => record.conversions))
  const revenue = sum(records.map((record) => record.revenue))
  const groupedByDate = new Map<string, ContentRecord[]>()
  const groupedByCategory = new Map<string, ContentRecord[]>()
  for (const record of records) {
    groupedByDate.set(record.date, [...(groupedByDate.get(record.date) ?? []), record])
    groupedByCategory.set(record.category, [...(groupedByCategory.get(record.category) ?? []), record])
  }
  const trend = [...groupedByDate.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, values]) => ({
    date, published: sum(values.map((value) => value.published)), views: sum(values.map((value) => value.views)), revenue: sum(values.map((value) => value.revenue)),
  }))
  const categories: CategoryMetric[] = [...groupedByCategory.entries()].map(([category, values]) => {
    const categoryViews = sum(values.map((value) => value.views))
    const categoryConversions = sum(values.map((value) => value.conversions))
    return { category, published: sum(values.map((value) => value.published)), views: categoryViews, conversions: categoryConversions, revenue: sum(values.map((value) => value.revenue)), conversionRate: percent(categoryConversions, categoryViews) }
  }).sort((left, right) => right.revenue - left.revenue)
  const weakest = [...categories].filter((category) => category.views > 0).sort((left, right) => left.conversionRate - right.conversionRate)[0]
  const strongest = categories[0]
  const planCompletion = percent(published, planned)
  const timeframe = `${trend[0].date} 至 ${trend.at(-1)!.date}`
  const conclusion = planCompletion >= 1
    ? `内容发布已完成计划，当前应优先提升高流量内容的转化效率。`
    : `内容发布完成度为 ${(planCompletion * 100).toFixed(1)}%，应优先补齐排期并保障核心内容产出。`
  const diagnostic = weakest
    ? `${weakest.category} 的转化率最低（${(weakest.conversionRate * 100).toFixed(2)}%），是当前最优先的优化对象。`
    : '当前没有足够的浏览量数据来判断内容转化表现。'
  const actions: ContentDashboardModel['actions'] = [
    { priority: planCompletion < 1 ? '高' : '中', evidence: `计划完成度 ${(planCompletion * 100).toFixed(1)}%`, nextStep: planCompletion < 1 ? '补齐未完成排期，并按日跟踪发布进度。' : '保持当前发布节奏，复盘高表现内容。', expectedDirection: '提升计划完成度与内容供给稳定性' },
    { priority: '高', evidence: weakest ? `${weakest.category} 转化率 ${(weakest.conversionRate * 100).toFixed(2)}%` : '转化数据不足', nextStep: weakest ? `优化 ${weakest.category} 的选题、落地页与行动引导。` : '补充内容转化记录。', expectedDirection: '提升转化率' },
    { priority: '中', evidence: strongest ? `${strongest.category} 贡献收入 ¥${strongest.revenue.toFixed(0)}` : '暂无品类数据', nextStep: strongest ? `复用 ${strongest.category} 的内容策略至相近主题。` : '补充品类标签。', expectedDirection: '扩大有效收入贡献' },
  ]
  return { timeframe, freshness: new Date().toISOString(), conclusion, kpis: { published, planCompletion, views, conversionRate: percent(conversions, views), revenue }, trend, categories, diagnostic, actions }
}
