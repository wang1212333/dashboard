import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { migratePostgres } from './migrate.js'
import type { ApprovalStatus, JsonObject, ObjectReference, PlanStatus, RevisionStage, RunState, RunStatus, SemanticContextStatus, SessionStatus, SourceMode, StepStatus, UploadSource, UploadStatus, WorkspaceRole } from './contracts.js'

type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>
const now = () => new Date().toISOString()
const json = (value: JsonObject | undefined): string => JSON.stringify(value ?? {})
const jsonList = (value: JsonObject[] | undefined): string => JSON.stringify(value ?? [])
const id = (value?: string): string => value ?? randomUUID()

function assertHash(value: string): void {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('SHA256_INVALID')
}

function assertObject(reference: ObjectReference): void {
  if (!reference.objectUri.trim()) throw new Error('OBJECT_URI_REQUIRED')
  if (!Number.isSafeInteger(reference.byteSize) || reference.byteSize < 0) throw new Error('OBJECT_SIZE_INVALID')
  if (!reference.mediaType.trim()) throw new Error('OBJECT_MEDIA_TYPE_REQUIRED')
  assertHash(reference.sha256)
}

/**
 * Authoritative storage for DSH business state. It deliberately stores only
 * object references, never the CSV or generated HTML body itself.
 */
export class PostgresCoreStore {
  constructor(private readonly pool: Pool) {}

  async migrate(): Promise<string[]> { return migratePostgres(this.pool) }
  async close(): Promise<void> { await this.pool.end() }

  async createWorkspace(input: { id?: string; slug: string; name: string; createdByUserId: string; metadata?: JsonObject }): Promise<string> {
    const workspaceId = id(input.id)
    await this.pool.query('INSERT INTO workspaces (id, slug, name, created_by_user_id, metadata) VALUES ($1, $2, $3, $4, $5::jsonb)', [workspaceId, input.slug, input.name, input.createdByUserId, json(input.metadata)])
    await this.upsertWorkspaceMember({ workspaceId, userId: input.createdByUserId, role: 'owner' })
    return workspaceId
  }

  async upsertWorkspaceMember(input: { workspaceId: string; userId: string; role: WorkspaceRole }): Promise<void> {
    await this.pool.query(`INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES ($1, $2, $3)
      ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role, updated_at = now()`, [input.workspaceId, input.userId, input.role])
  }

  async createAnalysisSession(input: { id?: string; workspaceId: string; createdByUserId: string; title: string; sourceMode: SourceMode; contextSummary?: JsonObject }): Promise<string> {
    const sessionId = id(input.id)
    await this.pool.query(`INSERT INTO analysis_sessions (id, workspace_id, created_by_user_id, title, source_mode, context_summary)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)`, [sessionId, input.workspaceId, input.createdByUserId, input.title, input.sourceMode, json(input.contextSummary)])
    return sessionId
  }

  async setSessionStatus(sessionId: string, status: SessionStatus): Promise<void> {
    await this.pool.query('UPDATE analysis_sessions SET status = $2, updated_at = now(), closed_at = CASE WHEN $2 = \'active\' THEN NULL ELSE now() END WHERE id = $1', [sessionId, status])
  }

  async appendConversationMessage(input: { id?: string; sessionId: string; sequenceNumber: number; role: 'user' | 'assistant' | 'system' | 'tool'; content: JsonObject; visibleToUser?: boolean; toolName?: string; metadata?: JsonObject }): Promise<string> {
    const messageId = id(input.id)
    await this.pool.query(`INSERT INTO conversation_messages (id, session_id, sequence_number, role, content, visible_to_user, tool_name, metadata)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb)`, [messageId, input.sessionId, input.sequenceNumber, input.role, json(input.content), input.visibleToUser ?? true, input.toolName ?? null, json(input.metadata)])
    return messageId
  }

  async createAgentRun(input: { id?: string; workspaceId: string; sessionId?: string; requestedByUserId: string; workflowVersion: string; state: RunState; status?: RunStatus; inputSummary?: JsonObject; traceId?: string; idempotencyKey?: string }): Promise<string> {
    const runId = id(input.id)
    await this.pool.query(`INSERT INTO agent_runs (id, workspace_id, session_id, requested_by_user_id, workflow_version, state, status, input_summary, trace_id, idempotency_key, started_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, CASE WHEN $7 = 'running' THEN now() ELSE NULL END)`, [runId, input.workspaceId, input.sessionId ?? null, input.requestedByUserId, input.workflowVersion, input.state, input.status ?? 'queued', json(input.inputSummary), input.traceId ?? null, input.idempotencyKey ?? null])
    return runId
  }

  async updateAgentRun(input: { runId: string; state: RunState; status: RunStatus; resultSummary?: JsonObject }): Promise<void> {
    await this.pool.query(`UPDATE agent_runs SET state = $2, status = $3, result_summary = $4::jsonb, updated_at = now(),
      started_at = CASE WHEN $3 = 'running' AND started_at IS NULL THEN now() ELSE started_at END,
      completed_at = CASE WHEN $3 IN ('completed', 'failed', 'cancelled') THEN now() ELSE NULL END WHERE id = $1`, [input.runId, input.state, input.status, json(input.resultSummary)])
  }

  async appendRunStep(input: { id?: string; runId: string; position: number; stepKey: RunState; status: StepStatus; attempt?: number; inputSummary?: JsonObject; outputSummary?: JsonObject; errorCode?: string; startedAt?: string; completedAt?: string }): Promise<string> {
    const stepId = id(input.id)
    await this.pool.query(`INSERT INTO run_steps (id, run_id, position, step_key, status, attempt, input_summary, output_summary, error_code, started_at, completed_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)`, [stepId, input.runId, input.position, input.stepKey, input.status, input.attempt ?? 1, json(input.inputSummary), json(input.outputSummary), input.errorCode ?? null, input.startedAt ?? (input.status === 'running' ? now() : null), input.completedAt ?? (input.status === 'completed' || input.status === 'failed' || input.status === 'skipped' ? now() : null)])
    return stepId
  }

  async saveSemanticContext(input: { id?: string; workspaceId: string; sessionId?: string; runId?: string; status: SemanticContextStatus; provider?: string; queryText: string; adoptedAssets?: JsonObject[]; evidence?: JsonObject; unresolvedItems?: JsonObject[]; validatedAt?: string }): Promise<string> {
    const contextId = id(input.id)
    await this.pool.query(`INSERT INTO semantic_contexts (id, workspace_id, session_id, run_id, status, provider, query_text, adopted_assets, evidence, unresolved_items, validated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11)
      ON CONFLICT (run_id) DO UPDATE SET status = EXCLUDED.status, adopted_assets = EXCLUDED.adopted_assets, evidence = EXCLUDED.evidence, unresolved_items = EXCLUDED.unresolved_items, validated_at = EXCLUDED.validated_at
      RETURNING id`, [contextId, input.workspaceId, input.sessionId ?? null, input.runId ?? null, input.status, input.provider ?? 'openmetadata', input.queryText, jsonList(input.adoptedAssets), json(input.evidence), jsonList(input.unresolvedItems), input.validatedAt ?? null])
    return contextId
  }

  async saveDashboardPlan(input: { id?: string; workspaceId: string; sessionId?: string; runId?: string; semanticContextId?: string; status?: PlanStatus; content: JsonObject; createdByUserId: string }): Promise<string> {
    const planId = id(input.id)
    await this.pool.query(`INSERT INTO dashboard_plans (id, workspace_id, session_id, run_id, semantic_context_id, status, content, created_by_user_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`, [planId, input.workspaceId, input.sessionId ?? null, input.runId ?? null, input.semanticContextId ?? null, input.status ?? 'proposed', json(input.content), input.createdByUserId])
    return planId
  }

  async confirmDashboardPlan(input: { planId: string; confirmedByUserId: string }): Promise<void> {
    await this.pool.query("UPDATE dashboard_plans SET status = 'confirmed', confirmed_by_user_id = $2, confirmed_at = now(), updated_at = now() WHERE id = $1 AND status = 'proposed'", [input.planId, input.confirmedByUserId])
  }

  async saveDashboardSpec(input: { id?: string; workspaceId: string; planId: string; dashboardId?: string; version?: number; content: JsonObject; semanticContextId?: string; visualContract?: JsonObject; createdByUserId: string }): Promise<{ specId: string; dashboardId: string }> {
    const specId = id(input.id)
    const dashboardId = id(input.dashboardId)
    await this.pool.query(`INSERT INTO dashboard_specs (id, workspace_id, plan_id, dashboard_id, version, content, semantic_context_id, visual_contract, created_by_user_id)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9)`, [specId, input.workspaceId, input.planId, dashboardId, input.version ?? 1, json(input.content), input.semanticContextId ?? null, json(input.visualContract), input.createdByUserId])
    return { specId, dashboardId }
  }

  async createDashboardRevision(input: { id?: string; workspaceId: string; dashboardId: string; specId?: string; revisionNumber: number; stage: RevisionStage; assetKey: string; manifest: JsonObject; qualityReport?: JsonObject; createdByUserId: string }): Promise<string> {
    const revisionId = id(input.id)
    await this.pool.query(`INSERT INTO dashboard_revisions (id, workspace_id, dashboard_id, spec_id, revision_number, stage, asset_key, manifest, quality_report, created_by_user_id, released_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, CASE WHEN $6 = 'released' THEN now() ELSE NULL END)`, [revisionId, input.workspaceId, input.dashboardId, input.specId ?? null, input.revisionNumber, input.stage, input.assetKey, json(input.manifest), json(input.qualityReport), input.createdByUserId])
    return revisionId
  }

  async updateDashboardRevisionStage(input: { revisionId: string; stage: RevisionStage }): Promise<void> {
    await this.pool.query(`UPDATE dashboard_revisions SET stage = $2, updated_at = now(), released_at = CASE WHEN $2 = 'released' THEN now() ELSE released_at END WHERE id = $1`, [input.revisionId, input.stage])
  }

  async createArtifact(input: { id?: string; workspaceId: string; ownerType: 'upload' | 'dashboard_revision' | 'semantic_context' | 'run_step'; ownerId: string; object: ObjectReference }): Promise<string> {
    assertObject(input.object)
    const artifactId = id(input.id)
    await this.pool.query(`INSERT INTO artifacts (id, workspace_id, owner_type, owner_id, object_uri, sha256, byte_size, media_type)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [artifactId, input.workspaceId, input.ownerType, input.ownerId, input.object.objectUri, input.object.sha256.toLowerCase(), input.object.byteSize, input.object.mediaType])
    return artifactId
  }

  async attachArtifactToRevision(input: { revisionId: string; artifactId: string; role: 'dashboard_html' | 'manifest' | 'model' | 'quality_report' | 'thumbnail' | 'source_snapshot' }): Promise<void> {
    await this.pool.query('INSERT INTO dashboard_revision_artifacts (dashboard_revision_id, artifact_id, role) VALUES ($1, $2, $3)', [input.revisionId, input.artifactId, input.role])
  }

  async createApproval(input: { id?: string; workspaceId: string; resourceType: string; resourceId: string; action: string; requestedByUserId: string; requestPayload?: JsonObject; expiresAt?: string }): Promise<string> {
    const approvalId = id(input.id)
    await this.pool.query(`INSERT INTO approvals (id, workspace_id, resource_type, resource_id, action, requested_by_user_id, request_payload, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`, [approvalId, input.workspaceId, input.resourceType, input.resourceId, input.action, input.requestedByUserId, json(input.requestPayload), input.expiresAt ?? null])
    return approvalId
  }

  async decideApproval(input: { approvalId: string; status: Extract<ApprovalStatus, 'approved' | 'rejected' | 'cancelled'>; decidedByUserId: string; decisionNote?: string }): Promise<void> {
    await this.pool.query(`UPDATE approvals SET status = $2, decided_by_user_id = $3, decision_note = $4, decided_at = now()
      WHERE id = $1 AND status = 'pending'`, [input.approvalId, input.status, input.decidedByUserId, input.decisionNote ?? null])
  }

  async appendAuditEvent(input: { id?: string; workspaceId: string; actorUserId: string; action: string; resourceType: string; resourceId?: string; requestId?: string; detail?: JsonObject }): Promise<string> {
    const eventId = id(input.id)
    await this.pool.query(`INSERT INTO audit_events (id, workspace_id, actor_user_id, action, resource_type, resource_id, request_id, detail)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`, [eventId, input.workspaceId, input.actorUserId, input.action, input.resourceType, input.resourceId ?? null, input.requestId ?? null, json(input.detail)])
    return eventId
  }

  async createUpload(input: { id?: string; workspaceId: string; sessionId?: string; uploadedByUserId: string; source: UploadSource; originalFileName: string; object: ObjectReference; status?: UploadStatus; expiresAt?: string; metadata?: JsonObject }): Promise<string> {
    assertObject(input.object)
    const uploadId = id(input.id)
    await this.pool.query(`INSERT INTO uploads (id, workspace_id, session_id, uploaded_by_user_id, source, original_file_name, object_uri, sha256, byte_size, media_type, status, expires_at, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`, [uploadId, input.workspaceId, input.sessionId ?? null, input.uploadedByUserId, input.source, input.originalFileName, input.object.objectUri, input.object.sha256.toLowerCase(), input.object.byteSize, input.object.mediaType, input.status ?? 'available', input.expiresAt ?? null, json(input.metadata)])
    return uploadId
  }

  /** Atomic revision + audit write, used by the production lifecycle endpoint. */
  async createAuditedDashboardRevision(input: Parameters<PostgresCoreStore['createDashboardRevision']>[0] & { audit: Parameters<PostgresCoreStore['appendAuditEvent']>[0] }): Promise<string> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const revisionId = await this.insertDashboardRevision(client, input)
      await this.insertAuditEvent(client, { ...input.audit, resourceId: revisionId })
      await client.query('COMMIT')
      return revisionId
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private async insertDashboardRevision(client: Queryable, input: Parameters<PostgresCoreStore['createDashboardRevision']>[0]): Promise<string> {
    const revisionId = id(input.id)
    await client.query(`INSERT INTO dashboard_revisions (id, workspace_id, dashboard_id, spec_id, revision_number, stage, asset_key, manifest, quality_report, created_by_user_id, released_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, CASE WHEN $6 = 'released' THEN now() ELSE NULL END)`, [revisionId, input.workspaceId, input.dashboardId, input.specId ?? null, input.revisionNumber, input.stage, input.assetKey, json(input.manifest), json(input.qualityReport), input.createdByUserId])
    return revisionId
  }

  private async insertAuditEvent(client: Queryable, input: Parameters<PostgresCoreStore['appendAuditEvent']>[0]): Promise<string> {
    const eventId = id(input.id)
    await client.query(`INSERT INTO audit_events (id, workspace_id, actor_user_id, action, resource_type, resource_id, request_id, detail)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`, [eventId, input.workspaceId, input.actorUserId, input.action, input.resourceType, input.resourceId ?? null, input.requestId ?? null, json(input.detail)])
    return eventId
  }
}
