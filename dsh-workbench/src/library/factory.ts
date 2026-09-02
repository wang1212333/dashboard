import type { WorkbenchPluginConfig } from '../service.js'
import { FilesystemKnowledgeLibrary } from './filesystem-library.js'
import { HttpMetadataRepository, HttpObjectStore } from './http-adapters.js'
import type { KnowledgeLibrary } from './knowledge-library.js'
import { StaticIdentityProvider, type IdentityProvider } from './ports.js'
import { WorkspaceKnowledgeLibrary } from './workspace-library.js'

function readToken(variable?: string): string | undefined {
  if (!variable) return undefined
  const value = process.env[variable]
  if (!value) throw new Error(`SECRET_ENV_MISSING:${variable}`)
  return value
}

/** Selects the local P1 adapter or the P2 remote object-store + metadata adapter. */
export function createKnowledgeLibrary(config: WorkbenchPluginConfig, identity?: IdentityProvider): KnowledgeLibrary {
  if ((config.libraryAdapter ?? 'filesystem') === 'filesystem') {
    return new FilesystemKnowledgeLibrary(config.libraryRoot ?? './dsh-workbench-library')
  }
  if (!config.objectStorageEndpoint || !config.metadataServiceEndpoint) {
    throw new Error('REMOTE_LIBRARY_CONFIG_REQUIRED: objectStorageEndpoint and metadataServiceEndpoint are required')
  }
  return new WorkspaceKnowledgeLibrary(
    new HttpObjectStore({ endpoint: config.objectStorageEndpoint, bearerToken: readToken(config.objectStorageTokenEnv) }),
    new HttpMetadataRepository({ endpoint: config.metadataServiceEndpoint, bearerToken: readToken(config.metadataServiceTokenEnv) }),
    identity ?? new StaticIdentityProvider(config.developmentIdentity),
  )
}
