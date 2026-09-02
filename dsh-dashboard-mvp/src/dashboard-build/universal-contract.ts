/**
 * The default information architecture derived from the user's universal
 * dashboard template. Domain templates decide metrics and charts; this
 * contract keeps every rendered page understandable and auditable.
 */
export const UNIVERSAL_DASHBOARD_SECTIONS = ['context', 'filters', 'conclusions', 'narrative', 'actions', 'exploration', 'trust'] as const
export type UniversalDashboardSection = typeof UNIVERSAL_DASHBOARD_SECTIONS[number]

export interface DashboardInformationArchitecture {
  templateId: 'universal-dashboard/v1'
  sections: UniversalDashboardSection[]
  kpiRange: { min: 3; max: 6 }
  drilldownDepth: 3
}

export interface DashboardVisualContract {
  schemaVersion: 'dashboard-visual/v1'
  designTemplateId: string
  palette: { canvas: string; surface: string; elevated: string; primary: string; primaryText: string; text: string; muted: string; hairline: string; success: string; warning: string; danger: string }
  typography: { displayFamily: string; bodyFamily: string; monoFamily: string }
  components: { cardRadiusPx: number; controlRadiusPx: number; sectionGapPx: number; darkCanvas: boolean }
}

const HEX = /^#[0-9a-f]{6}$/i
const TEMPLATE_ID = /^[a-z0-9][a-z0-9.-]{1,80}$/i
const FONT = /^[a-zA-Z0-9 ,"'()-]{1,120}$/

export function defaultInformationArchitecture(): DashboardInformationArchitecture {
  return { templateId: 'universal-dashboard/v1', sections: [...UNIVERSAL_DASHBOARD_SECTIONS], kpiRange: { min: 3, max: 6 }, drilldownDepth: 3 }
}

export function defaultDashboardVisualContract(): DashboardVisualContract {
  return {
    schemaVersion: 'dashboard-visual/v1', designTemplateId: 'universal-default',
    palette: { canvas: '#f4f6fa', surface: '#ffffff', elevated: '#edf2f7', primary: '#3155c6', primaryText: '#ffffff', text: '#172033', muted: '#667085', hairline: '#dfe4ed', success: '#087e65', warning: '#a36106', danger: '#b42318' },
    typography: { displayFamily: 'Microsoft YaHei, Arial, sans-serif', bodyFamily: 'Microsoft YaHei, Arial, sans-serif', monoFamily: 'Consolas, monospace' },
    components: { cardRadiusPx: 12, controlRadiusPx: 8, sectionGapPx: 18, darkCanvas: false },
  }
}

export function isDashboardVisualContract(value: unknown): value is DashboardVisualContract {
  if (!value || typeof value !== 'object') return false
  const visual = value as Partial<DashboardVisualContract>
  return visual.schemaVersion === 'dashboard-visual/v1' && typeof visual.designTemplateId === 'string' && TEMPLATE_ID.test(visual.designTemplateId)
    && !!visual.palette && Object.values(visual.palette).every(value => typeof value === 'string' && HEX.test(value))
    && !!visual.typography && Object.values(visual.typography).every(value => typeof value === 'string' && FONT.test(value))
    && !!visual.components && Number.isInteger(visual.components.cardRadiusPx) && Number.isInteger(visual.components.controlRadiusPx) && Number.isInteger(visual.components.sectionGapPx)
    && typeof visual.components.darkCanvas === 'boolean'
}

/** Reject malformed custom values by falling back to a stable, safe default. */
export function normalizeDashboardVisualContract(value: unknown): DashboardVisualContract {
  if (!isDashboardVisualContract(value)) return defaultDashboardVisualContract()
  return {
    schemaVersion: 'dashboard-visual/v1', designTemplateId: value.designTemplateId,
    palette: { ...value.palette }, typography: { ...value.typography },
    components: {
      cardRadiusPx: clamp(value.components.cardRadiusPx, 0, 24), controlRadiusPx: clamp(value.components.controlRadiusPx, 0, 24),
      sectionGapPx: clamp(value.components.sectionGapPx, 8, 120), darkCanvas: value.components.darkCanvas,
    },
  }
}

export function visualContractCss(visual: DashboardVisualContract): string {
  const { palette, typography, components } = visual
  return `<style>:root{--canvas:${palette.canvas};--surface:${palette.surface};--elevated:${palette.elevated};--brand:${palette.primary};--brand-text:${palette.primaryText};--ink:${palette.text};--muted:${palette.muted};--line:${palette.hairline};--good:${palette.success};--warn:${palette.warning};--bad:${palette.danger};--radius-card:${components.cardRadiusPx}px;--radius-control:${components.controlRadiusPx}px;--section-gap:${components.sectionGapPx}px}body{background:var(--canvas)!important;color:var(--ink)!important;font-family:${typography.bodyFamily}!important}h1,h2,.value,.kpi-value{font-family:${typography.displayFamily}!important}.card,section,.action{background:var(--surface)!important;border-color:var(--line)!important;border-radius:var(--radius-card)!important}section{margin-top:var(--section-gap)!important}.filter span{border-radius:var(--radius-control)!important}header{background:linear-gradient(135deg,var(--ink),var(--brand))!important;color:var(--brand-text)!important}.diagnostic{background:var(--elevated)!important;border-left-color:var(--warn)!important}.bar-track{background:var(--elevated)!important}.bar i,.bar-track i{background:var(--brand)!important}</style>`
}

export function trustSectionHtml(input: { sourceLabel?: string; freshness: string; semanticStatus?: string; evidenceCount?: number }): string {
  const status = input.semanticStatus === 'verified' ? `已验证（${input.evidenceCount ?? 0} 项语义证据）` : input.semanticStatus === 'incomplete' ? '未完成，不能作为可信方案发布' : '未接入或未验证'
  return `<section data-dashboard-role="trust"><h2>数据可信度</h2><div class="trust-grid"><p><strong>数据来源：</strong>${escapeHtml(input.sourceLabel || 'CSV 数据集')}</p><p><strong>最后刷新：</strong>${escapeHtml(input.freshness.replace('T', ' ').slice(0, 19))}</p><p><strong>语义验证：</strong>${escapeHtml(status)}</p><p><strong>已知限制：</strong>当前视图仅反映已映射字段与有效记录。</p></div></section>`
}

/** Applies the universal layout footer and the persisted visual tokens to legacy domain renderers. */
export function applyUniversalDashboardContract(html: string, input: { visualContract?: DashboardVisualContract; sourceLabel?: string; freshness: string; semanticStatus?: string; evidenceCount?: number }): string {
  const visual = input.visualContract ?? defaultDashboardVisualContract()
  const withTrust = html.replace('</main>', `${trustSectionHtml(input)}</main>`)
  return withTrust.replace('</body>', `${visualContractCss(visual)}</body>`)
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
