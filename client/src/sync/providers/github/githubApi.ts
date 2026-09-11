import type { GitHubSyncPublicConfig } from '../../types'

const API_ROOT = 'https://api.github.com'

export class GitHubApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'GitHubApiError'
  }
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

export class GitHubApi {
  constructor(
    private readonly config: GitHubSyncPublicConfig,
    private readonly token: string,
  ) {}

  private repoPath(path = ''): string {
    return `/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repository)}${path}`
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${API_ROOT}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    })
    if (!response.ok) {
      let detail = response.statusText
      try { detail = (await response.json() as { message?: string }).message || detail } catch { /* non-JSON error */ }
      throw new GitHubApiError(`GitHub: ${detail}`, response.status)
    }
    return response.status === 204 ? undefined as T : response.json() as Promise<T>
  }

  getRepository(): Promise<{ default_branch: string; permissions?: { push?: boolean } }> {
    return this.request(this.repoPath())
  }

  getRef(): Promise<{ object: { sha: string } }> {
    return this.request(this.repoPath(`/git/ref/heads/${encodeURIComponent(this.config.branch)}`))
  }

  getCommit(sha: string): Promise<{ tree: { sha: string } }> {
    return this.request(this.repoPath(`/git/commits/${encodeURIComponent(sha)}`))
  }

  async getFile<T>(path: string): Promise<{ value: T; sha: string }> {
    const result = await this.request<{ content: string; encoding: string; sha: string }>(
      this.repoPath(`/contents/${encodePath(path)}?ref=${encodeURIComponent(this.config.branch)}`),
    )
    if (result.encoding !== 'base64') throw new Error(`Unsupported GitHub content encoding: ${result.encoding}`)
    const compact = result.content.replace(/\s/g, '')
    const bytes = Uint8Array.from(atob(compact), c => c.charCodeAt(0))
    return { value: JSON.parse(new TextDecoder().decode(bytes)) as T, sha: result.sha }
  }

  createBlob(value: unknown): Promise<{ sha: string }> {
    const json = `${JSON.stringify(value, null, 2)}\n`
    const bytes = new TextEncoder().encode(json)
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return this.request(this.repoPath('/git/blobs'), {
      method: 'POST',
      body: JSON.stringify({ content: btoa(binary), encoding: 'base64' }),
    })
  }

  createTree(baseTree: string, entries: Array<{ path: string; sha: string | null }>): Promise<{ sha: string }> {
    return this.request(this.repoPath('/git/trees'), {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseTree,
        tree: entries.map(entry => ({ ...entry, mode: '100644', type: 'blob' })),
      }),
    })
  }

  createCommit(message: string, tree: string, parent: string): Promise<{ sha: string }> {
    return this.request(this.repoPath('/git/commits'), {
      method: 'POST',
      body: JSON.stringify({ message, tree, parents: [parent] }),
    })
  }

  updateRef(sha: string): Promise<unknown> {
    return this.request(this.repoPath(`/git/refs/heads/${encodeURIComponent(this.config.branch)}`), {
      method: 'PATCH',
      body: JSON.stringify({ sha, force: false }),
    })
  }

  initializeManifest(manifest: unknown): Promise<unknown> {
    const json = `${JSON.stringify(manifest, null, 2)}\n`
    const bytes = new TextEncoder().encode(json)
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return this.request(this.repoPath('/contents/manifest.json'), {
      method: 'PUT',
      body: JSON.stringify({
        message: 'Initialize Travel PWA data',
        content: btoa(binary),
      }),
    })
  }
}
