import { describe, expect, it } from 'vitest'
import { DATA_MCP, METADATA_MCP, OPENMETADATA_MCP } from '../src/data-connectors/mcp-contracts.js'
import { assertReadOnlyBoundedSql } from '../src/data-connectors/data-mcp.js'

describe('MCP reservations', () => {
  it('uses stable, separate namespaces for metadata and data', () => {
    expect(METADATA_MCP.serverName).toBe('workbench_metadata')
    expect(DATA_MCP.serverName).toBe('workbench_data')
    expect(METADATA_MCP.tools.searchProduct).toMatch(/^mcp__workbench_metadata__/)
    expect(DATA_MCP.tools.queryData).toMatch(/^mcp__workbench_data__/)
    expect(OPENMETADATA_MCP.tools.semanticSearch).toMatch(/^mcp__openmetadata_semantic__/)
  })

  it('allows only a single bounded read query', () => {
    expect(() => assertReadOnlyBoundedSql('SELECT region, SUM(amount) FROM sales GROUP BY region LIMIT 20')).not.toThrow()
    expect(() => assertReadOnlyBoundedSql('DELETE FROM sales LIMIT 1')).toThrow('QUERY_MUST_BE_READ_ONLY')
    expect(() => assertReadOnlyBoundedSql('SELECT * FROM sales')).toThrow('QUERY_BOUND_REQUIRED')
    expect(() => assertReadOnlyBoundedSql('SELECT * FROM sales LIMIT 10')).toThrow('QUERY_WILDCARD_FORBIDDEN')
    expect(() => assertReadOnlyBoundedSql('SELECT region FROM sales LIMIT 1001')).toThrow('QUERY_LIMIT_TOO_LARGE')
    expect(() => assertReadOnlyBoundedSql('WITH x AS (SELECT region FROM sales) SELECT region FROM x LIMIT 20')).not.toThrow()
  })
})
