import type {
  ApplyPatchReceipt,
  ApplyPatchRequest,
  AssetSummary,
  ChangePlan,
  RowMutationReceipt,
  RowMutationRequest,
} from './contracts.js'
import type { WorkspacePrincipal } from './library/ports.js'

export interface WorkbenchPluginConfig {
  workspaceId?: string
  /** P1 only: absolute or profile-relative local library root. */
  libraryRoot?: string
  /** P2: remote uses immutable object storage plus an authoritative metadata service. */
  libraryAdapter?: 'filesystem' | 'remote'
  objectStorageEndpoint?: string
  metadataServiceEndpoint?: string
  /** Environment-variable names only; never place service tokens in a patch file. */
  objectStorageTokenEnv?: string
  metadataServiceTokenEnv?: string
  /** Local integration identity. Production binds this from trusted host middleware instead. */
  developmentIdentity?: WorkspacePrincipal
  /** Local development only. Production must delegate approval to the API gateway. */
  allowDevWrites?: boolean
}

export interface WorkbenchService {
  inspect(assetId: string): Promise<AssetSummary>
  planChange(assetId: string, intent: string): Promise<ChangePlan>
  /** Gate externally visible lifecycle changes; production delegates this to its approval service. */
  assertLifecycleApproval(approvalId: string): void
  applyPatch(request: ApplyPatchRequest): Promise<ApplyPatchReceipt>
  mutateRow(request: RowMutationRequest): Promise<RowMutationReceipt>
}

type LocalAsset = AssetSummary & { nodeIds: Set<string> }

/**
 * Deliberately tiny in-memory adapter. Replace this with an API adapter before
 * enabling writes in any shared environment.
 */
export class LocalWorkbenchService implements WorkbenchService {
  private readonly assets = new Map<string, LocalAsset>()
  private readonly idempotency = new Map<string, ApplyPatchReceipt | RowMutationReceipt>()
  private readonly rows = new Map<string, { version: number; values: Record<string, unknown>; deleted: boolean }>()

  constructor(private readonly config: Required<Pick<WorkbenchPluginConfig, 'workspaceId' | 'allowDevWrites'>> & { hostManagedLifecycleApprovals: boolean }) {
    this.assets.set('demo-dashboard', {
      id: 'demo-dashboard',
      workspaceId: config.workspaceId,
      kind: 'html',
      title: '内容运营周看板',
      revision: 'rev-0001',
      bindings: ['content-calendar'],
      nodeIds: new Set(['hero-title', 'weekly-chart', 'todo-list']),
    })
  }

  async inspect(assetId: string): Promise<AssetSummary> {
    const asset = this.requireAsset(assetId)
    return this.summary(asset)
  }

  async planChange(assetId: string, intent: string): Promise<ChangePlan> {
    const asset = this.requireAsset(assetId)
    return {
      planId: `plan-${Date.now()}`,
      assetId,
      baseRevision: asset.revision,
      intent,
      risk: /删除|发布|delete|publish/i.test(intent) ? 'high' : 'low',
      proposedOperations: [{
        targetNodeId: 'hero-title',
        operation: 'replaceText',
        rationale: 'The local demo uses a stable node id; a production planner must derive this from an AST selection.',
      }],
    }
  }

  assertLifecycleApproval(approvalId: string): void {
    if (this.config.hostManagedLifecycleApprovals) {
      if (!approvalId) throw new Error('APPROVAL_REQUIRED: use an approval issued by the host')
      return
    }
    this.assertWriteAllowed(approvalId)
  }

  async applyPatch(request: ApplyPatchRequest): Promise<ApplyPatchReceipt> {
    const previous = this.idempotency.get(request.idempotencyKey)
    if (previous && 'changedNodeIds' in previous) return { ...previous, status: 'already_applied' }
    this.assertWriteAllowed(request.approvalId)
    const asset = this.requireAsset(request.assetId)
    if (asset.revision !== request.baseRevision) throw new Error(`REVISION_CONFLICT: current revision is ${asset.revision}`)
    for (const patch of request.patches) {
      if (!asset.nodeIds.has(patch.targetNodeId)) throw new Error(`UNKNOWN_NODE: ${patch.targetNodeId}`)
    }
    asset.revision = this.nextRevision(asset.revision)
    const receipt: ApplyPatchReceipt = {
      revision: asset.revision,
      changedNodeIds: request.patches.map((patch) => patch.targetNodeId),
      status: 'applied',
    }
    this.idempotency.set(request.idempotencyKey, receipt)
    return receipt
  }

  async mutateRow(request: RowMutationRequest): Promise<RowMutationReceipt> {
    const previous = this.idempotency.get(request.idempotencyKey)
    if (previous && 'rowId' in previous) return { ...previous, status: 'already_applied' }
    this.assertWriteAllowed(request.approvalId)
    const key = `${request.tableId}:${request.rowId}`
    const existing = this.rows.get(key)
    if (request.operation === 'update' && !existing) throw new Error(`ROW_NOT_FOUND: ${request.rowId}`)
    if (request.baseVersion !== undefined && existing?.version !== request.baseVersion) throw new Error('ROW_VERSION_CONFLICT')
    const next = {
      version: (existing?.version ?? 0) + 1,
      values: request.operation === 'softDelete' ? (existing?.values ?? {}) : { ...existing?.values, ...request.values },
      deleted: request.operation === 'softDelete',
    }
    this.rows.set(key, next)
    const receipt: RowMutationReceipt = { rowId: request.rowId, version: next.version, status: 'applied' }
    this.idempotency.set(request.idempotencyKey, receipt)
    return receipt
  }

  private assertWriteAllowed(approvalId: string): void {
    if (!this.config.allowDevWrites) throw new Error('WRITE_DISABLED: configure a production API approval adapter before enabling writes')
    if (!approvalId.startsWith('dev-approved-')) throw new Error('APPROVAL_REQUIRED: use an approval issued by the host')
  }

  private requireAsset(assetId: string): LocalAsset {
    const asset = this.assets.get(assetId)
    if (!asset) throw new Error(`ASSET_NOT_FOUND: ${assetId}`)
    if (asset.workspaceId !== this.config.workspaceId) throw new Error('WORKSPACE_DENIED')
    return asset
  }

  private summary(asset: LocalAsset): AssetSummary {
    const { nodeIds: _nodeIds, ...summary } = asset
    return summary
  }

  private nextRevision(revision: string): string {
    const next = Number(revision.slice(-4)) + 1
    return `rev-${String(next).padStart(4, '0')}`
  }
}

export function createWorkbenchService(config: WorkbenchPluginConfig = {}): WorkbenchService {
  return new LocalWorkbenchService({
    workspaceId: config.workspaceId ?? 'local-demo',
    allowDevWrites: config.allowDevWrites ?? false,
    hostManagedLifecycleApprovals: config.libraryAdapter === 'remote',
  })
}
