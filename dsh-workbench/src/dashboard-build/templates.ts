import { REQUIRED_COLUMNS, type DashboardTemplate } from './contracts.js'

const CONTENT_OPERATIONS_TEMPLATE: DashboardTemplate = {
  id: 'content-ops-v1',
  displayName: '内容运营看板',
  dataContract: 'content-ops-v1',
  expectedColumns: REQUIRED_COLUMNS,
  requiredKpis: ['published', 'planCompletion', 'views', 'conversionRate'],
}

const FINANCE_PNL_TEMPLATE: DashboardTemplate = {
  id: 'finance-pnl-v1',
  displayName: '财务利润看板',
  dataContract: 'finance-pnl-v1',
  expectedColumns: ['period', 'dimension', 'revenue', 'cost', 'profit'],
  requiredKpis: ['revenue', 'cost', 'profit', 'profitMargin'],
}

const SUPPLY_SALES_TEMPLATE: DashboardTemplate = {
  id: 'supply-sales-v1',
  displayName: '产销协同驾驶舱',
  dataContract: 'supply-sales-v1',
  expectedColumns: ['period', 'country', 'forecast', 'shipments', 'sellIn', 'sellOut', 'inventory', 'dos'],
  requiredKpis: ['forecast', 'shipments', 'sellOut', 'inventory'],
}

/**
 * A flexible contract for item-level operating data. Unlike supply-sales-v1,
 * this does not prescribe a fixed four-page inventory cockpit: the confirmed
 * storyline decides which supported modules are actually rendered.
 */
const SKU_OPERATIONS_TEMPLATE: DashboardTemplate = {
  id: 'sku-operations-v1',
  displayName: 'SKU 运营工作台',
  dataContract: 'sku-operations-v1',
  expectedColumns: ['period', 'item', 'inventory'],
  requiredKpis: ['inventory', 'sellOut', 'dos'],
}

const TEMPLATES = new Map([[CONTENT_OPERATIONS_TEMPLATE.id, CONTENT_OPERATIONS_TEMPLATE], [FINANCE_PNL_TEMPLATE.id, FINANCE_PNL_TEMPLATE], [SUPPLY_SALES_TEMPLATE.id, SUPPLY_SALES_TEMPLATE], [SKU_OPERATIONS_TEMPLATE.id, SKU_OPERATIONS_TEMPLATE]])

export function getDashboardTemplate(templateId = CONTENT_OPERATIONS_TEMPLATE.id): DashboardTemplate {
  const template = TEMPLATES.get(templateId)
  if (!template) throw new Error(`DASHBOARD_TEMPLATE_NOT_FOUND:${templateId}`)
  return template
}

export function listDashboardTemplates(): DashboardTemplate[] {
  return [...TEMPLATES.values()]
}
