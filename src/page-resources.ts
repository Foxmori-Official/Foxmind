import type { DirectResource } from './shared'

// Injected as a standalone function in the active tab's isolated world.
export function readPageResources(): { url: string; resources: DirectResource[] } {
  const files = /\.(?:pdf|docx?|xlsx?|pptx?|epub|txt|csv|json|zip|rar|7z|gz|tar|srt|vtt|ass|mp4|webm|mkv|mov|m4v|mp3|m4a|ogg|opus|wav|flac|aac|m3u8|mpd)$/i
  const candidates = new Map<string, DirectResource>()
  for (const element of document.querySelectorAll('a[href], video, audio, video source[src], audio source[src], track[src]')) {
    const anchor = element instanceof HTMLAnchorElement
    const src = anchor ? element.getAttribute('href') :
      element instanceof HTMLMediaElement ? element.currentSrc || element.getAttribute('src') : element.getAttribute('src')
    if (!src?.trim()) continue

    let url: URL
    try { url = new URL(src, document.baseURI) } catch { continue }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) continue
    if (anchor && !element.hasAttribute('download') && !files.test(url.pathname)) continue
    url.hash = ''
    if (candidates.has(url.href)) continue

    const filename = url.pathname.split('/').pop() || url.hostname
    const extension = filename.match(/\.([a-z0-9]{1,10})$/i)?.[1]?.toLowerCase()
    let name = element.getAttribute('download') || filename
    try { name = decodeURIComponent(name) } catch { /* Keep undecodable URLs readable. */ }
    const type = extension === 'm3u8' ? 'HLS' : extension === 'mpd' ? 'DASH' : extension?.toUpperCase() ?? 'FILE'
    candidates.set(url.href, { url: url.href, name: name.slice(0, 180), type })
    if (candidates.size >= 100) break
  }
  for (const entry of performance.getEntriesByType('resource')) {
    if (candidates.size >= 150) break
    let url: URL
    try { url = new URL(entry.name) } catch { continue }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || !files.test(url.pathname)) continue
    url.hash = ''
    if (candidates.has(url.href)) continue
    let name = url.pathname.split('/').pop() || url.hostname
    try { name = decodeURIComponent(name) } catch {}
    const ext = url.pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase()
    candidates.set(url.href, { url: url.href, name: name.slice(0, 180),
      type: ext === 'm3u8' ? 'HLS' : ext === 'mpd' ? 'DASH' : ext?.toUpperCase() || 'FILE', source: 'network' })
  }
  return { url: location.href, resources: [...candidates.values()] }
}
