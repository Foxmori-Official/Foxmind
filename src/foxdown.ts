import { FoxmindError, type DirectResource, type PageIdentity } from './shared.ts'

export function normalizeServer(value: string): string {
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new FoxmindError('invalidServerUrl') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new FoxmindError('invalidServerUrl')
  }
  return url.href.replace(/\/+$/, '')
}

export function serverPermission(value: string): string {
  return new URL(normalizeServer(value)).origin + '/*'
}

async function request(server: string, token: string, path: string, body?: unknown) {
  const url = normalizeServer(server)
  if (!await chrome.permissions.contains({ origins: [serverPermission(url)] })) throw new FoxmindError('serverPermission')
  let response: Response
  try {
    response = await fetch(url + '/api/v1/' + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        Accept: 'application/json',
        ...(token.trim() ? { Authorization: 'Bearer ' + token.trim() } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
  } catch { throw new FoxmindError('serverUnavailable') }
  if (response.status === 401 || response.status === 403) throw new FoxmindError('serverAuth')
  if (!response.ok) throw new FoxmindError('downloadFailed')
  try { return await response.json() } catch { throw new FoxmindError('serverUnavailable') }
}

export async function checkFoxdown(server: string, token: string): Promise<void> {
  const result = await request(server, token, 'health')
  if (result?.ok !== true || result.app !== 'foxdown') throw new FoxmindError('serverUnavailable')
  if (!result.aria2) throw new FoxmindError('serverEngine')
}

export async function networkResources(page: PageIdentity): Promise<DirectResource[]> {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'resources', ...page })
    return Array.isArray(result) ? result : []
  } catch { return [] }
}

export function mergeResources(direct: DirectResource[], network: DirectResource[]): DirectResource[] {
  const found = new Map<string, DirectResource>()
  for (const item of [...network, ...direct]) {
    if (!/^https?:\/\//i.test(item.url)) continue
    const url = new URL(item.url)
    if (url.username || url.password) continue
    url.hash = ''
    if (!found.has(url.href)) found.set(url.href, { ...item, url: url.href })
  }
  const playlists = new Set([...found.values()].filter(item => ['HLS', 'DASH'].includes(item.type)).map(item => new URL(item.url).host))
  return [...found.values()].filter(item => !playlists.has(new URL(item.url).host) || !/\.(?:ts|m4s)(?:\?|$)/i.test(item.url))
}

export async function queueResource(server: string, token: string, page: PageIdentity, item: DirectResource) {
  const options: Record<string, unknown> = { referer: page.pageUrl }
  if (item.headers) {
    options.headers = Object.entries(item.headers)
      .filter(([name, value]) => ['cookie', 'referer', 'origin', 'authorization', 'user-agent'].includes(name) && !/[\r\n]/.test(value))
      .map(([name, value]) => name + ': ' + value)
  }
  const result = await request(server, token, 'tasks', { url: item.url, options, reuseActive: true })
  if (typeof result?.id !== 'string' || !result.id) throw new FoxmindError('downloadFailed')
}
