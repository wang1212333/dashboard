import { createHash } from 'node:crypto'
import { parseTabularCsv } from './csv-profile.js'

/**
 * Immutable facts about the exact CSV used to propose a dashboard plan.
 * This is deliberately data-only: it can be kept in a plan/spec and checked
 * without exposing a local file path or raw rows to the model.
 */
export interface CsvSourceSnapshot {
  schemaVersion: 'csv-source/v1'
  sha256: string
  byteLength: number
  rowCount: number
  headerCount: number
}

export function snapshotCsvSource(csv: string): CsvSourceSnapshot {
  const dataset = parseTabularCsv(csv)
  return {
    schemaVersion: 'csv-source/v1',
    sha256: createHash('sha256').update(csv, 'utf8').digest('hex'),
    byteLength: Buffer.byteLength(csv, 'utf8'),
    rowCount: dataset.rows.length,
    headerCount: dataset.headers.length,
  }
}

export function isCsvSourceSnapshot(value: unknown): value is CsvSourceSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Partial<CsvSourceSnapshot>
  return snapshot.schemaVersion === 'csv-source/v1'
    && typeof snapshot.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(snapshot.sha256)
    && Number.isInteger(snapshot.byteLength) && Number(snapshot.byteLength) > 0
    && Number.isInteger(snapshot.rowCount) && Number(snapshot.rowCount) > 0
    && Number.isInteger(snapshot.headerCount) && Number(snapshot.headerCount) > 0
}

/** Fails closed when a renderer is handed a sample, a modified file, or a different upload. */
export function assertCsvMatchesSnapshot(csv: string, expected: CsvSourceSnapshot): CsvSourceSnapshot {
  const actual = snapshotCsvSource(csv)
  if (actual.sha256 !== expected.sha256 || actual.byteLength !== expected.byteLength || actual.rowCount !== expected.rowCount || actual.headerCount !== expected.headerCount) {
    throw new Error(`DASHBOARD_SOURCE_INTEGRITY_MISMATCH:expected=${expected.rowCount}:actual=${actual.rowCount}`)
  }
  return actual
}

/**
 * A point-in-time KPI must not silently use a one-row late-arriving partition
 * as the latest snapshot. The rule compares the latest partition to the
 * typical earlier partition and deliberately blocks the build for review.
 */
export function assertLatestPeriodComplete(csv: string, periodColumn: string | undefined): void {
  if (!periodColumn) return
  const dataset = parseTabularCsv(csv)
  if (!dataset.headers.includes(periodColumn)) return
  const counts = new Map<string, number>()
  for (const row of dataset.rows) {
    const period = row[periodColumn]?.trim()
    if (period) counts.set(period, (counts.get(period) ?? 0) + 1)
  }
  if (counts.size < 2) return
  const partitions = [...counts.entries()].sort(([left], [right]) => left.localeCompare(right))
  const [latestPeriod, latestCount] = partitions.at(-1)!
  const earlierCounts = partitions.slice(0, -1).map(([, count]) => count).sort((left, right) => left - right)
  const middle = Math.floor(earlierCounts.length / 2)
  const baseline = earlierCounts.length % 2 ? earlierCounts[middle]! : (earlierCounts[middle - 1]! + earlierCounts[middle]!) / 2
  // Tiny ad-hoc datasets are common in tests and previews; a 1→2 change is
  // not enough evidence of a broken partition. Apply the guard only once the
  // historical partitions are materially sized.
  if (baseline < 10) return
  const minimumCompleteRows = Math.max(3, Math.ceil(baseline * 0.35))
  if (latestCount < minimumCompleteRows) throw new Error(`DASHBOARD_LATEST_PERIOD_INCOMPLETE:${latestPeriod}:${latestCount}/${Math.round(baseline)}`)
}

/**
 * Protect known, non-interchangeable inventory semantics from header-order
 * mistakes. The rule only runs when both competing fields exist, so it never
 * invents a missing business measure.
 */
export function assertSkuMetricSemantics(csv: string, mapping: Record<string, string | undefined>): void {
  const headers = parseTabularCsv(csv).headers
  if (headers.includes('chnl_dos') && headers.includes('total_chnl_dos') && mapping.dos === 'total_chnl_dos') {
    throw new Error('DASHBOARD_SEMANTIC_MAPPING_REQUIRED:dos=chnl_dos')
  }
  if (headers.includes('total_sell_out') && headers.includes('period_sell_out') && mapping.sellOut === 'period_sell_out') {
    throw new Error('DASHBOARD_SEMANTIC_MAPPING_REQUIRED:sellOut=total_sell_out')
  }
}
