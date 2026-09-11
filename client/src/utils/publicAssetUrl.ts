/** Resolve a file from Vite's public directory under the current deployment base. */
export function publicAssetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`
}
