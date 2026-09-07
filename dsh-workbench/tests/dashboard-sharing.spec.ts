import { afterEach, expect, it, vi } from 'vitest'
import { createDashboardShare, dashboardShareState, revokeDashboardShare } from '../src/local-app/dashboard-sharing.js'
import type { KnowledgeLibrary } from '../src/library/knowledge-library.js'

afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()})
function setup() {
  vi.stubEnv('DSH_ONLINE_URL','https://example.com')
  vi.stubEnv('DSH_ONLINE_ADMIN_TOKEN','test-token')
  return {getAsset:vi.fn().mockResolvedValue({latestRevision:'rev-0002',releasedRevision:'rev-0001'}),readRevision:vi.fn().mockResolvedValue({manifest:{displayName:'Board'},revision:{revision:'rev-0001',stage:'released'},html:'<html>board</html>'})} as unknown as KnowledgeLibrary
}
it('shares the released revision, preserves lifecycle and requests reuse with chosen validity',async()=>{
  const library=setup(), fetcher=vi.fn().mockImplementation(async()=>new Response('{}'))
  vi.stubGlobal('fetch',fetcher)
  await createDashboardShare(library,'sample-board',30)
  expect(library.readRevision).toHaveBeenCalledWith('sample-board','rev-0001')
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({assetId:'sample-board',revision:'rev-0001',days:30,reuse:true})
  await expect(createDashboardShare(library,'sample-board',0)).rejects.toThrow('DAYS_INVALID')
})
it('does not allow revoking a token belonging to a different board',async()=>{
  setup(); const fetcher=vi.fn().mockImplementation(async()=>new Response('{"shares":[]}'))
  vi.stubGlobal('fetch',fetcher)
  await expect(revokeDashboardShare('sample-board','a'.repeat(48))).rejects.toThrow('NOT_FOUND')
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('opening share state performs reads only',async()=>{
  const library=setup(),fetcher=vi.fn().mockResolvedValue(new Response('{"shares":[]}'))
  vi.stubGlobal('fetch',fetcher)
  expect(await dashboardShareState(library,'sample-board')).toMatchObject({revision:'rev-0001',shares:[]})
  expect(fetcher.mock.calls[0][1].method).toBe('GET')
})
