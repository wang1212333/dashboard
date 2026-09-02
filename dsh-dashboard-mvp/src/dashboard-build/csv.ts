import { REQUIRED_COLUMNS, type ContentRecord, type DataQualityReport, type RequiredColumn } from './contracts.js'

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = []
  let cell = ''
  let row: string[] = []
  let quoted = false
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]
    const next = csv[index + 1]
    if (character === '"' && quoted && next === '"') { cell += '"'; index += 1; continue }
    if (character === '"') { quoted = !quoted; continue }
    if (character === ',' && !quoted) { row.push(cell.trim()); cell = ''; continue }
    if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index += 1
      row.push(cell.trim()); cell = ''
      if (row.some(Boolean)) rows.push(row)
      row = []
      continue
    }
    cell += character
  }
  if (quoted) throw new Error('CSV_QUOTE_UNCLOSED')
  row.push(cell.trim())
  if (row.some(Boolean)) rows.push(row)
  return rows
}

function numeric(value: string, column: string): number {
  const result = Number(value)
  if (!Number.isFinite(result) || result < 0) throw new Error(`INVALID_${column.toUpperCase()}`)
  return result
}

function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function parseContentCsv(csv: string): { records: ContentRecord[]; quality: DataQualityReport } {
  const rows = parseCsvRows(csv)
  if (rows.length < 2) throw new Error('CSV_HAS_NO_DATA')
  const header = rows[0].map((cell) => cell.trim().toLowerCase())
  const missing = REQUIRED_COLUMNS.filter((column) => !header.includes(column))
  if (missing.length > 0) throw new Error(`CSV_COLUMNS_REQUIRED:${missing.join(',')}`)
  const indexes = Object.fromEntries(REQUIRED_COLUMNS.map((column) => [column, header.indexOf(column)])) as Record<RequiredColumn, number>
  const records: ContentRecord[] = []
  const rejectedRows: DataQualityReport['rejectedRows'] = []
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index]
    try {
      const date = row[indexes.date] ?? ''
      const category = row[indexes.category] ?? ''
      if (!isValidIsoDate(date)) throw new Error('INVALID_DATE')
      if (!category) throw new Error('CATEGORY_REQUIRED')
      records.push({
        date,
        category,
        planned: numeric(row[indexes.planned] ?? '', 'planned'),
        published: numeric(row[indexes.published] ?? '', 'published'),
        views: numeric(row[indexes.views] ?? '', 'views'),
        conversions: numeric(row[indexes.conversions] ?? '', 'conversions'),
        revenue: numeric(row[indexes.revenue] ?? '', 'revenue'),
      })
    } catch (error) {
      rejectedRows.push({ row: index + 1, reason: error instanceof Error ? error.message : 'INVALID_ROW' })
    }
  }
  if (records.length === 0) throw new Error('CSV_HAS_NO_VALID_RECORDS')
  const dates = records.map((record) => record.date).sort()
  return { records, quality: { validRows: records.length, rejectedRows, dateRange: { start: dates[0], end: dates.at(-1)! } } }
}
