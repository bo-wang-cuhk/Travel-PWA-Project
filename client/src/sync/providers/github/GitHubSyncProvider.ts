import type { SyncedTrip } from '../../../domain/tripSyncModel'
import type { GitHubSyncPublicConfig, LocalChange, ProviderStatus, PushResult, RemoteChanges, SyncProvider } from '../../types'
import { GitHubApi, GitHubApiError } from './githubApi'
import { EMPTY_MANIFEST, type GitHubManifest } from './githubTypes'

export class RemoteAdvancedError extends Error {
  constructor() {
    super('Remote repository changed during sync')
    this.name = 'RemoteAdvancedError'
  }
}

export class GitHubSyncProvider implements SyncProvider {
  readonly id = 'github'
  private readonly api: GitHubApi
  private connected = false

  constructor(private readonly config: GitHubSyncPublicConfig, token: string) {
    if (!token) throw new Error('GitHub token is required')
    this.api = new GitHubApi(config, token)
  }

  async connect(): Promise<ProviderStatus> {
    const repo = await this.api.getRepository()
    if (repo.permissions?.push === false) throw new Error('Token does not have repository write permission')
    try {
      await this.api.getRef()
    } catch (error) {
      if (!(error instanceof GitHubApiError) || error.status !== 404) throw error
      await this.api.initializeManifest(EMPTY_MANIFEST)
      await this.api.getRef()
    }
    this.connected = true
    return { connected: true, message: `${this.config.owner}/${this.config.repository}` }
  }

  async disconnect(): Promise<void> {
    this.connected = false
  }

  async getStatus(): Promise<ProviderStatus> {
    return { connected: this.connected }
  }

  async pull(cursor?: string | null): Promise<RemoteChanges> {
    const ref = await this.api.getRef()
    const head = ref.object.sha
    if (cursor && cursor === head) return { cursor: head, changes: [] }

    let manifest: GitHubManifest
    try {
      manifest = (await this.api.getFile<GitHubManifest>('manifest.json')).value
    } catch (error) {
      if (!(error instanceof GitHubApiError) || error.status !== 404) throw error
      manifest = EMPTY_MANIFEST
    }
    if (manifest.schemaVersion !== 1) throw new Error(`Unsupported sync schema: ${manifest.schemaVersion}`)

    const changes = await Promise.all(Object.entries(manifest.trips).map(async ([entityId, entry]) => {
      if (entry.deletedAt) {
        return { entityType: 'trip' as const, entityId, operation: 'delete' as const, remoteVersion: entry.contentHash }
      }
      const trip = await this.api.getFile<SyncedTrip>(entry.path)
      return {
        entityType: 'trip' as const,
        entityId,
        operation: 'upsert' as const,
        remoteVersion: entry.contentHash || trip.sha,
        payload: trip.value,
      }
    }))
    return { cursor: head, changes }
  }

  async push(changes: LocalChange[], cursor?: string | null): Promise<PushResult> {
    if (changes.length === 0) {
      const head = (await this.api.getRef()).object.sha
      return { cursor: head, versions: {} }
    }
    const ref = await this.api.getRef()
    const head = ref.object.sha
    if (cursor && cursor !== head) throw new RemoteAdvancedError()

    const commit = await this.api.getCommit(head)
    let manifest: GitHubManifest
    try { manifest = (await this.api.getFile<GitHubManifest>('manifest.json')).value }
    catch (error) {
      if (!(error instanceof GitHubApiError) || error.status !== 404) throw error
      manifest = { ...EMPTY_MANIFEST, trips: {} }
    }

    const next: GitHubManifest = { ...manifest, trips: { ...manifest.trips }, updatedAt: new Date().toISOString() }
    const treeEntries: Array<{ path: string; sha: string | null }> = []
    const versions: Record<string, string> = {}

    for (const change of changes) {
      const path = `trips/${change.entityId}/trip.json`
      if (change.operation === 'delete') {
        const version = `deleted:${Date.now()}:${change.entityId}`
        const previous = next.trips[change.entityId]
        next.trips[change.entityId] = { path, updatedAt: next.updatedAt, deletedAt: next.updatedAt, contentHash: version }
        if (previous && !previous.deletedAt) treeEntries.push({ path, sha: null })
        versions[change.entityId] = version
      } else {
        const blob = await this.api.createBlob(change.payload)
        const updatedAt = (change.payload as SyncedTrip | undefined)?.updatedAt || next.updatedAt
        next.trips[change.entityId] = { path, updatedAt, deletedAt: null, contentHash: blob.sha }
        treeEntries.push({ path, sha: blob.sha })
        versions[change.entityId] = blob.sha
      }
    }

    const manifestBlob = await this.api.createBlob(next)
    treeEntries.push({ path: 'manifest.json', sha: manifestBlob.sha })
    const tree = await this.api.createTree(commit.tree.sha, treeEntries)
    const created = await this.api.createCommit('Sync Travel PWA trips', tree.sha, head)
    try {
      await this.api.updateRef(created.sha)
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 422) throw new RemoteAdvancedError()
      throw error
    }
    return { cursor: created.sha, versions }
  }
}
