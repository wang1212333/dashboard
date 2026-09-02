export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer'
export type SessionStatus = 'active' | 'completed' | 'cancelled' | 'failed' | 'archived'
export type SourceMode = 'file' | 'omd' | 'library' | 'feishu' | 'mixed' | 'unknown'
export type RunState = 'data_profile' | 'omd_readiness' | 'semantic_search' | 'entity_details' | 'semantic_validate' | 'plan' | 'await_confirmation' | 'spec' | 'governance' | 'draft' | 'completed' | 'failed' | 'cancelled'
export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type StepStatus = 'queued' | 'running' | 'completed' | 'failed' | 'skipped'
export type SemanticContextStatus = 'verified' | 'incomplete' | 'unavailable' | 'rejected'
export type PlanStatus = 'proposed' | 'confirmed' | 'superseded' | 'rejected'
export type RevisionStage = 'draft' | 'preview' | 'released' | 'superseded' | 'archived'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled'
export type UploadSource = 'local_file' | 'library' | 'feishu' | 'omd' | 'data_mcp' | 'external'
export type UploadStatus = 'pending' | 'available' | 'rejected' | 'expired' | 'deleted'

export interface ObjectReference {
  objectUri: string
  sha256: string
  byteSize: number
  mediaType: string
}
