import type { AuditEvent, AuditEventInput, MetadataAsset, MetadataRepository, MetadataRevision, ObjectStore } from './ports.js'
import type { ReleasePointer } from './contracts.js'

interface HttpClientConfig { endpoint: string; bearerToken?: string }

class HttpClient {
  constructor(private readonly config: HttpClientConfig) {}

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    headers.set('accept', 'application/json')
    if (this.config.bearerToken) headers.set('authorization', `Bearer ${this.config.bearerToken}`)
    const response = await fetch(new URL(path, this.config.endpoint), { ...init, headers })
    if (!response.ok) throw new Error(`REMOTE_${response.status}:${await response.text()}`)
    if (response.status === 204) return undefined as T
    return await response.json() as T
  }

  async requestText(path: string): Promise<string> {
    const headers = new Headers({ accept: 'text/plain' })
    if (this.config.bearerToken) headers.set('authorization', `Bearer ${this.config.bearerToken}`)
    const response = await fetch(new URL(path, this.config.endpoint), { headers })
    if (!response.ok) throw new Error(`REMOTE_${response.status}:${await response.text()}`)
    return response.text()
  }
}

/** REST adapter contract: PUT/GET /v1/objects/{encoded-key}; the server must reject existing keys. */
export class HttpObjectStore implements ObjectStore {
  private readonly client: HttpClient
  constructor(config: HttpClientConfig) { this.client = new HttpClient(config) }

  async putImmutable(key: string, body: string, contentType: string): Promise<void> {
    await this.client.request<void>(`/v1/objects/${encodeURIComponent(key)}`, {
      method: 'PUT', body, headers: { 'content-type': contentType, 'if-none-match': '*' },
    })
  }

  async getText(key: string): Promise<string> {
    return this.client.requestText(`/v1/objects/${encodeURIComponent(key)}`)
  }
}

/**
 * REST adapter contract. Metadata service endpoints are scoped below
 * /v1/workspaces/{workspaceId}/assets/{assetId}; mutation payloads contain an
 * audit field and must atomically commit both the state change and audit event.
 */
export class HttpMetadataRepository implements MetadataRepository {
  private readonly client: HttpClient
  constructor(config: HttpClientConfig) { this.client = new HttpClient(config) }
  async getAsset(workspaceId: string, assetId: string): Promise<MetadataAsset | undefined> { return this.find<MetadataAsset>(`/v1/workspaces/${encodeURIComponent(workspaceId)}/assets/${encodeURIComponent(assetId)}`) }
  async getRevision(workspaceId: string, assetId: string, revision: string): Promise<MetadataRevision | undefined> { return this.find<MetadataRevision>(`/v1/workspaces/${encodeURIComponent(workspaceId)}/assets/${encodeURIComponent(assetId)}/revisions/${encodeURIComponent(revision)}`) }
  async createDraft(input: { workspaceId: string; asset: MetadataAsset['asset']; revision: MetadataRevision; audit: AuditEventInput }): Promise<void> { await this.client.request('/v1/library/drafts', this.json('POST', input)) }
  async preview(input: { workspaceId: string; assetId: string; revision: string; audit: AuditEventInput }): Promise<MetadataRevision> { return this.client.request('/v1/library/revisions/preview', this.json('POST', input)) }
  async release(input: { workspaceId: string; assetId: string; revision: string; approvalId: string; audit: AuditEventInput }): Promise<ReleasePointer> { return this.client.request('/v1/library/releases', this.json('POST', input)) }
  async rollback(input: { workspaceId: string; assetId: string; revision: string; approvalId: string; audit: AuditEventInput }): Promise<ReleasePointer> { return this.client.request('/v1/library/releases/rollback', this.json('POST', input)) }
  async getRelease(workspaceId: string, assetId: string): Promise<ReleasePointer | undefined> { return this.find<ReleasePointer>(`/v1/workspaces/${encodeURIComponent(workspaceId)}/assets/${encodeURIComponent(assetId)}/release`) }
  async appendAudit(event: AuditEventInput): Promise<void> { await this.client.request('/v1/library/audits', this.json('POST', event)) }
  async listAudit(workspaceId: string, assetId: string): Promise<AuditEvent[]> { return this.client.request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/assets/${encodeURIComponent(assetId)}/audits`) }
  private json(method: string, value: unknown): RequestInit { return { method, body: JSON.stringify(value), headers: { 'content-type': 'application/json' } } }
  private async find<T>(path: string): Promise<T | undefined> { try { return await this.client.request<T>(path) } catch (error) { if (error instanceof Error && error.message.startsWith('REMOTE_404:')) return undefined; throw error } }
}
