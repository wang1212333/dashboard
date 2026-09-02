import { randomUUID } from 'node:crypto'

type JsonRecord = Record<string, unknown>

export type OpenMetadataAssetCandidate = {
  fqn: string
  entityType: string
  name: string
  description?: string
  service?: string
  domain?: string
  columns: string[]
  similarityScore?: number
}

export type OpenMetadataAssetDetail = OpenMetadataAssetCandidate & {
  glossaryTerms: string[]
  tags: string[]
  owners: string[]
  raw: unknown
}

export class OpenMetadataMcpError extends Error {
  constructor(message: string, readonly statusCode = 502) { super(message) }
}

/**
 * Server-only client for the OMD streamable-HTTP MCP endpoint.
 * It deliberately returns a small safe projection to the browser: credentials
 * and the raw MCP protocol stay on the host, while the user can select a
 * candidate asset before any analysis workflow continues.
 */
export class OpenMetadataSemanticHttpClient {
  private initialized?: Promise<void>

  constructor(private readonly options: {
    url?: string
    token?: string
    fetchImpl?: typeof fetch
  } = {}) {}

  configured(): boolean { return Boolean(this.url() && this.token()) }

  async search(query: string, size = 8): Promise<{ query: string; results: OpenMetadataAssetCandidate[]; totalFound?: number; hasMore?: boolean }> {
    if (!query.trim()) throw new OpenMetadataMcpError('OMD_QUERY_REQUIRED', 400)
    const result = await this.callTool('semantic_search', { query: query.trim(), size: Math.min(Math.max(size, 1), 10) })
    const content = structuredContent(result)
    const records = Array.isArray(content.results) ? content.results : []
    return {
      query: typeof content.query === 'string' ? content.query : query.trim(),
      results: records.map(toCandidate).filter((candidate): candidate is OpenMetadataAssetCandidate => Boolean(candidate)),
      totalFound: numberValue(content.totalFound),
      hasMore: content.hasMore === true,
    }
  }

  async details(entityType: string, fqn: string): Promise<OpenMetadataAssetDetail> {
    if (!entityType.trim() || !fqn.trim()) throw new OpenMetadataMcpError('OMD_ASSET_REQUIRED', 400)
    const result = await this.callTool('get_entity_details', { entityType: entityType.trim(), fqn: fqn.trim() })
    const content = structuredContent(result)
    const candidate = toCandidate({ ...content, fullyQualifiedName: content.fullyQualifiedName ?? fqn.trim(), entityType: content.entityType ?? entityType.trim() }) ?? {
      fqn: fqn.trim(), entityType: entityType.trim(), name: fqn.trim().split('.').at(-1) ?? fqn.trim(), columns: [],
    }
    return {
      ...candidate,
      description: stringValue(content.description) ?? candidate.description,
      glossaryTerms: stringList(content.glossaryTerms ?? content.glossary),
      tags: namedList(content.tags),
      owners: namedList(content.owners),
      raw: content,
    }
  }

  private url(): string | undefined { return this.options.url ?? process.env.OPENMETADATA_MCP_URL }
  private token(): string | undefined { return this.options.token ?? process.env.OPENMETADATA_MCP_TOKEN }
  private fetcher(): typeof fetch { return this.options.fetchImpl ?? fetch }

  private async callTool(name: string, args: JsonRecord): Promise<JsonRecord> {
    if (!this.configured()) throw new OpenMetadataMcpError('OMD_MCP_NOT_CONFIGURED', 503)
    await (this.initialized ??= this.initialize())
    const response = await this.request({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name, arguments: args } })
    const payload = asRecord(response)
    if (payload.error) throw new OpenMetadataMcpError('OMD_MCP_CALL_FAILED', 502)
    const result = asRecord(payload.result)
    if (!result || result.isError === true) throw new OpenMetadataMcpError('OMD_MCP_CALL_FAILED', 502)
    return result
  }

  private async initialize(): Promise<void> {
    const initialized = await this.request({ jsonrpc: '2.0', id: randomUUID(), method: 'initialize', params: {
      protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'dsh-workbench', version: '0.4.0' },
    } })
    if (asRecord(initialized).error) throw new OpenMetadataMcpError('OMD_MCP_INITIALIZATION_FAILED', 502)
    await this.request({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })
  }

  private async request(body: JsonRecord): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetcher()(this.url()!, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.token()!}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify(body),
      })
    } catch { throw new OpenMetadataMcpError('OMD_MCP_UNREACHABLE', 503) }
    const text = await response.text()
    if (!response.ok) throw new OpenMetadataMcpError('OMD_MCP_UNAVAILABLE', response.status >= 400 && response.status < 600 ? response.status : 502)
    if (!text.trim()) return {}
    try { return JSON.parse(text) } catch { throw new OpenMetadataMcpError('OMD_MCP_PROTOCOL_INVALID', 502) }
  }
}

function asRecord(value: unknown): JsonRecord { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {} }
function stringValue(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined }
function numberValue(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined }
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => typeof item === 'string' ? item : stringValue(asRecord(item).name)).filter((item): item is string => Boolean(item)) : []
}
function namedList(value: unknown): string[] { return stringList(value) }

function structuredContent(result: JsonRecord): JsonRecord {
  const direct = asRecord(result.structuredContent)
  if (Object.keys(direct).length) return direct
  const content = Array.isArray(result.content) ? result.content : []
  for (const item of content) {
    const text = stringValue(asRecord(item).text)
    if (!text) continue
    try { const parsed = asRecord(JSON.parse(text)); if (Object.keys(parsed).length) return parsed } catch { /* Try the next text block. */ }
  }
  return {}
}

function toCandidate(value: unknown): OpenMetadataAssetCandidate | undefined {
  const record = asRecord(value)
  const fqn = stringValue(record.fullyQualifiedName) ?? stringValue(record.fqn)
  const entityType = stringValue(record.entityType)
  if (!fqn || !entityType) return undefined
  const columns = Array.isArray(record.columns)
    ? record.columns.map(column => stringValue(asRecord(column).name)).filter((column): column is string => Boolean(column)).slice(0, 12)
    : []
  return {
    fqn, entityType, name: stringValue(record.displayName) ?? stringValue(record.name) ?? fqn.split('.').at(-1) ?? fqn,
    description: stringValue(record.description),
    service: stringValue(asRecord(record.service).displayName) ?? stringValue(asRecord(record.service).name),
    domain: stringValue(asRecord(record.domain).displayName) ?? stringValue(asRecord(record.domain).name) ?? namedList(record.domains)[0],
    columns, similarityScore: numberValue(record.similarityScore),
  }
}
