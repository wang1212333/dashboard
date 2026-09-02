import type { LibraryAsset } from '../library/contracts.js'
import type { DashboardModel } from '../dashboard-build/contracts.js'

/** @deprecated Legacy behavior is no longer mounted; keep its interpolation value empty until that source is deleted. */
export const dashboardSeed: never[] = []

/** The small, user-facing projection of a stored dashboard. */
export interface DashboardSummary {
  id: string
  title: string
  description: string
  templateId: string
  updatedAt: string
  dashboardUrl: string
  previewKpis: Array<{ label: string; value: string }>
}

/** A generated dashboard is immediately listable; no lifecycle state is exposed. */
const labels: Record<string, string> = {
  revenue: '营收', cost: '成本', profit: '利润', profitMargin: '利润率',
  forecast: '预测', shipments: '发货', sellIn: 'Sell In', sellOut: 'Sell Out', inventory: '库存', inventoryDos: 'DOS',
  published: '已发布', planCompletion: '计划完成率', views: '浏览量', conversionRate: '转化率',
}

function displayValue(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: value % 1 === 0 ? 0 : 1 }).format(value)
}

function previewKpis(model: DashboardModel): DashboardSummary['previewKpis'] {
  if (!('kpis' in model)) return []
  const raw = model.kpis
  if (Array.isArray(raw)) return raw.slice(0, 4).map(kpi => ({ label: kpi.name, value: displayValue(kpi.value) }))
  return Object.entries(raw).slice(0, 4).map(([key, value]) => ({ label: labels[key] ?? key, value: displayValue(value) }))
}

export function toDashboardSummary(asset: LibraryAsset, dashboardUrl: string, model: DashboardModel): DashboardSummary {
  return {
    id: asset.assetId,
    title: asset.displayName,
    description: asset.source.label || `${asset.templateId} 看板`,
    templateId: asset.templateId,
    updatedAt: asset.updatedAt,
    dashboardUrl,
    previewKpis: previewKpis(model),
  }
}
