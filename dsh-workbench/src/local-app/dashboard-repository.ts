export type DashboardStatus = 'draft' | 'published'
export type DashboardScope = 'mine' | 'shared' | 'favorites'
export type DashboardViewMode = 'grid' | 'list'

export interface DashboardSummary {
  id: string
  title: string
  description?: string
  status: DashboardStatus
  currentVersion: number
  previewKind: 'overview' | 'sales' | 'funnel' | 'regional' | 'finance' | 'operations'
  updatedAt: string
  publishedAt?: string
  isFavorite: boolean
  ownerId: string
  ownerName: string
  sourceConversationId?: string
  sourceConversationName?: string
  sharedBy?: { userId: string; userName: string }
}

export interface DashboardVersion { id: string; dashboardId: string; version: number; status: 'draft' | 'published' | 'archived'; createdAt: string; publishedAt?: string; createdBy: string }
export interface DashboardRepository {
  list(input: { scope: DashboardScope; status?: DashboardStatus; query?: string }): Promise<DashboardSummary[]>
  getVersions(dashboardId: string): Promise<DashboardVersion[]>
  toggleFavorite(dashboardId: string, favorite: boolean): Promise<void>
  deleteDashboard(dashboardId: string): Promise<void>
  removeSharedDashboard?(dashboardId: string): Promise<void>
}

const seed: DashboardSummary[] = [
  { id: 'dashboard_001', title: '经营总览看板', description: '收入、订单与客户经营趋势概览', status: 'published', currentVersion: 3, previewKind: 'overview', updatedAt: '今天 10:24', publishedAt: '2026-08-31 09:58', isFavorite: true, ownerId: 'me', ownerName: '我', sourceConversationId: 'conversation_001', sourceConversationName: '经营数据分析需求' },
  { id: 'dashboard_002', title: '销售分析看板', description: '销售额、订单和渠道贡献分析', status: 'published', currentVersion: 2, previewKind: 'sales', updatedAt: '昨天 16:48', publishedAt: '2026-08-30 15:21', isFavorite: false, ownerId: 'me', ownerName: '我', sourceConversationId: 'conversation_002', sourceConversationName: '销售周报分析' },
  { id: 'dashboard_003', title: '客户转化漏斗看板', description: '从线索到成交的转化表现', status: 'draft', currentVersion: 1, previewKind: 'funnel', updatedAt: '昨天 14:12', isFavorite: false, ownerId: 'me', ownerName: '我', sourceConversationId: 'conversation_003', sourceConversationName: '客户转化分析' },
  { id: 'dashboard_004', title: '区域经营看板', description: '各区域营收与增长情况', status: 'published', currentVersion: 3, previewKind: 'regional', updatedAt: '2天前 21:33', publishedAt: '2026-08-29 10:11', isFavorite: false, ownerId: 'me', ownerName: '我', sourceConversationId: 'conversation_004', sourceConversationName: '区域经营复盘' },
  { id: 'dashboard_005', title: '财务状况看板', description: '现金余额与费用结构概览', status: 'draft', currentVersion: 1, previewKind: 'finance', updatedAt: '2天前 18:07', isFavorite: true, ownerId: 'me', ownerName: '我', sourceConversationId: 'conversation_005', sourceConversationName: '财务数据分析' },
  { id: 'dashboard_006', title: '产品运营看板', description: '流量、转化与留存运营趋势', status: 'published', currentVersion: 2, previewKind: 'operations', updatedAt: '3天前 11:55', publishedAt: '2026-08-28 17:32', isFavorite: false, ownerId: 'me', ownerName: '我', sourceConversationId: 'conversation_006', sourceConversationName: '产品运营复盘' },
  { id: 'dashboard_007', title: '渠道效能看板', description: '合作渠道增长与目标完成度', status: 'published', currentVersion: 2, previewKind: 'sales', updatedAt: '4天前 12:10', publishedAt: '2026-08-27 12:10', isFavorite: true, ownerId: 'market', ownerName: '市场团队', sourceConversationId: 'conversation_007', sourceConversationName: '渠道效能复盘', sharedBy: { userId: 'market', userName: '市场团队' } },
]
export const dashboardSeed = seed.map(item => ({ ...item, sharedBy: item.sharedBy ? { ...item.sharedBy } : undefined }))
/** Development adapter. A future Host-RPC adapter can satisfy this interface unchanged. */
export class MockDashboardRepository implements DashboardRepository {
  constructor(private readonly items = dashboardSeed.map(item => ({ ...item }))) {}
  private async delay() { await new Promise(resolve => setTimeout(resolve, 180)) }
  async list(input: { scope: DashboardScope; status?: DashboardStatus; query?: string }) { await this.delay(); const q = input.query?.trim().toLowerCase() ?? ''; return this.items.filter(item => (input.scope === 'mine' ? !item.sharedBy : input.scope === 'shared' ? !!item.sharedBy : item.isFavorite) && (!input.status || item.status === input.status) && (!q || `${item.title} ${item.description ?? ''}`.toLowerCase().includes(q))) }
  async getVersions(dashboardId: string) { await this.delay(); const item = this.items.find(entry => entry.id === dashboardId); if (!item) throw new Error('DASHBOARD_NOT_FOUND'); return Array.from({ length: item.currentVersion }, (_, index): DashboardVersion => ({ id: `${item.id}:v${item.currentVersion - index}`, dashboardId: item.id, version: item.currentVersion - index, status: index === 0 ? item.status : 'archived', createdAt: index === 0 ? item.publishedAt ?? '2026-08-31 09:58' : `2026-08-${31 - index} 15:21`, createdBy: item.ownerName })) }
  async toggleFavorite(id: string, favorite: boolean) { await this.delay(); const item = this.items.find(entry => entry.id === id); if (!item) throw new Error('DASHBOARD_NOT_FOUND'); item.isFavorite = favorite }
  async deleteDashboard(id: string) { await this.delay(); const index = this.items.findIndex(entry => entry.id === id); if (index < 0) throw new Error('DASHBOARD_NOT_FOUND'); this.items.splice(index, 1) }
  async removeSharedDashboard(id: string) { await this.deleteDashboard(id) }
}
