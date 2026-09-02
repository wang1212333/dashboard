import { describe, expect, it } from 'vitest'
import { createWorkbenchService } from '../src/service.js'

describe('LocalWorkbenchService', () => {
  it('plans without writing', async () => {
    const service = createWorkbenchService()
    const plan = await service.planChange('demo-dashboard', '将标题改成内容运营看板')
    expect(plan.baseRevision).toBe('rev-0001')
    expect(plan.proposedOperations[0].targetNodeId).toBe('hero-title')
  })

  it('requires a host-issued approval before writes', async () => {
    const service = createWorkbenchService({ allowDevWrites: false })
    await expect(service.applyPatch({
      assetId: 'demo-dashboard', baseRevision: 'rev-0001', approvalId: 'dev-approved-local', idempotencyKey: 'try-1',
      patches: [{ targetNodeId: 'hero-title', operation: 'replaceText', payload: { text: '新标题' } }],
    })).rejects.toThrow('WRITE_DISABLED')
  })

  it('uses the same approval gate for Release and Rollback lifecycle actions', () => {
    const disabled = createWorkbenchService({ allowDevWrites: false })
    expect(() => disabled.assertLifecycleApproval('dev-approved-local')).toThrow('WRITE_DISABLED')
    const enabled = createWorkbenchService({ allowDevWrites: true })
    expect(() => enabled.assertLifecycleApproval('not-an-approval')).toThrow('APPROVAL_REQUIRED')
    expect(() => enabled.assertLifecycleApproval('dev-approved-local')).not.toThrow()
  })

  it('makes retried writes idempotent', async () => {
    const service = createWorkbenchService({ allowDevWrites: true })
    const request = {
      assetId: 'demo-dashboard', baseRevision: 'rev-0001', approvalId: 'dev-approved-local', idempotencyKey: 'patch-1',
      patches: [{ targetNodeId: 'hero-title', operation: 'replaceText' as const, payload: { text: '新标题' } }],
    }
    await expect(service.applyPatch(request)).resolves.toMatchObject({ revision: 'rev-0002', status: 'applied' })
    await expect(service.applyPatch(request)).resolves.toMatchObject({ revision: 'rev-0002', status: 'already_applied' })
  })
})
