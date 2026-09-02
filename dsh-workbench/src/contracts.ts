export type AssetKind = 'html' | 'markdown' | 'csv'

export interface AssetSummary {
  id: string
  workspaceId: string
  kind: AssetKind
  title: string
  revision: string
  bindings: string[]
}

export interface ChangePlan {
  planId: string
  assetId: string
  baseRevision: string
  intent: string
  risk: 'low' | 'medium' | 'high'
  proposedOperations: Array<{
    targetNodeId: string
    operation: 'replaceText' | 'setAttribute' | 'insertChild' | 'removeNode'
    rationale: string
  }>
}

export interface ApplyPatchRequest {
  assetId: string
  baseRevision: string
  approvalId: string
  idempotencyKey: string
  patches: Array<{
    targetNodeId: string
    operation: 'replaceText' | 'setAttribute' | 'insertChild' | 'removeNode'
    payload: Record<string, unknown>
  }>
}

export interface ApplyPatchReceipt {
  revision: string
  changedNodeIds: string[]
  status: 'applied' | 'already_applied'
}

export interface RowMutationRequest {
  tableId: string
  operation: 'insert' | 'update' | 'softDelete'
  rowId: string
  baseVersion?: number
  values?: Record<string, unknown>
  approvalId: string
  idempotencyKey: string
}

export interface RowMutationReceipt {
  rowId: string
  version: number
  status: 'applied' | 'already_applied'
}
