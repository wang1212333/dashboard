import { describe, expect, it } from 'vitest'
import { assessOpenMetadataEvidence, OPENMETADATA_MCP } from '../src/data-connectors/openmetadata-mcp.js'

describe('OpenMetadata semantic MCP boundary', () => {
  it('reserves a dedicated native MCP namespace for semantic lookups', () => {
    expect(OPENMETADATA_MCP.serverName).toBe('openmetadata_semantic')
    expect(OPENMETADATA_MCP.tools.semanticSearch).toBe('mcp__openmetadata_semantic__semantic_search')
    expect(OPENMETADATA_MCP.tools.getEntityDetails).toBe('mcp__openmetadata_semantic__get_entity_details')
  })

  it('requires both candidate search and entity details before metadata becomes evidence', () => {
    const incomplete = assessOpenMetadataEvidence({
      question: '昨天各渠道激活成功率是多少？',
      selectedAssets: [{ fqn: 'hologres_prod.dw_prod.public.dws_active_daily', entityType: 'table', description: '激活日汇总', evidenceTools: ['semantic_search'] }],
    })
    expect(incomplete).toMatchObject({ valid: false, issues: ['SEMANTIC_DETAILS_EVIDENCE_REQUIRED:hologres_prod.dw_prod.public.dws_active_daily'] })

    const trusted = assessOpenMetadataEvidence({
      question: '昨天各渠道激活成功率是多少？', requestedMetrics: ['激活成功率'],
      selectedAssets: [{ fqn: 'hologres_prod.dw_prod.public.dws_active_daily', entityType: 'table', glossaryTerms: ['activationSuccessRate'], evidenceTools: ['semantic_search', 'get_entity_details'] }],
    })
    expect(trusted).toMatchObject({
      valid: true,
      evidenceSourceIds: ['openmetadata:hologres_prod.dw_prod.public.dws_active_daily'],
      issues: [],
      context: {
        schemaVersion: 'semantic-context/v1', status: 'verified',
        evidenceSourceIds: ['openmetadata:hologres_prod.dw_prod.public.dws_active_daily'],
        requestedMetrics: ['激活成功率'],
      },
    })
  })
})
