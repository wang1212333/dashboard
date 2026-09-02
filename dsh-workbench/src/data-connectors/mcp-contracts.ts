/**
 * Stable names reserved for the two host-mounted MCP servers.
 * DSH exposes them as native tools: mcp__<serverName>__<rawToolName>.
 */
export const METADATA_MCP = {
  serverName: 'workbench_metadata',
  tools: {
    searchProduct: 'mcp__workbench_metadata__search_metadata',
    getEntityDetails: 'mcp__workbench_metadata__get_entity_details',
    getAssetContext: 'mcp__workbench_metadata__get_asset_context',
  },
} as const

export const DATA_MCP = {
  serverName: 'workbench_data',
  tools: {
    listTables: 'mcp__workbench_data__list_tables',
    describeTable: 'mcp__workbench_data__describe_table',
    queryData: 'mcp__workbench_data__query_data',
  },
} as const

export { OPENMETADATA_MCP } from './openmetadata-mcp.js'

export interface MetadataMcpClient {
  searchProduct(clue: string, signal?: AbortSignal): Promise<unknown>
  getEntityDetails(fullyQualifiedName: string, signal?: AbortSignal): Promise<unknown>
  getAssetContext(assetId: string, signal?: AbortSignal): Promise<unknown>
}
