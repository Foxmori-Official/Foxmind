import type { DirectResource } from './shared'

interface Capture {
  url: string
  generation: string
  entries: DirectResource[]
}

const captures = new Map<number, Capture>()
const headers = new Map<string, { generation: string; values: Record<string, string> }>()
const key = (tabId: number) => 'foxmind-resources-' + tabId
const ready = chrome.storage.session.get(null).then(saved => {
  for (const [name, value] of Object.entries(saved)) {
    if (name.startsWith('foxmind-resources-') && value?.url && Array.isArray(value.entries)) {
      captures.set(Number(name.slice('foxmind-resources-'.length)), value)
    }
  }
})

export async function watchPage(tabId: number, url: string) {
  await ready
  if (captures.get(tabId)?.url === url) return
  const capture = { url, generation: crypto.randomUUID(), entries: [] }
  captures.set(tabId, capture)
  await chrome.storage.session.set({ [key(tabId)]: capture })
}

function clear(tabId: number) {
  void ready.then(() => {
    captures.delete(tabId)
    void chrome.storage.session.remove(key(tabId))
  })
}

chrome.tabs.onRemoved.addListener(clear)
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url || change.status === 'loading') clear(tabId)
})

chrome.webRequest.onSendHeaders.addListener(details => {
  const capture = captures.get(details.tabId)
  if (!capture) return
  const values: Record<string, string> = {}
  for (const header of details.requestHeaders ?? []) {
    const name = header.name.toLowerCase()
    if (['cookie', 'referer', 'origin', 'authorization', 'user-agent'].includes(name) && header.value) values[name] = header.value
  }
  headers.set(details.requestId, { generation: capture.generation, values })
  if (headers.size > 1_000) headers.delete(headers.keys().next().value!)
}, { urls: ['http://*/*', 'https://*/*'] }, ['requestHeaders', 'extraHeaders'])

chrome.webRequest.onResponseStarted.addListener(details => {
  const request = headers.get(details.requestId)
  headers.delete(details.requestId)
  const capture = captures.get(details.tabId)
  if (!capture || request?.generation !== capture.generation || details.statusCode >= 400) return
  const type = details.responseHeaders?.find(header => header.name.toLowerCase() === 'content-type')?.value ?? ''
  const suffix = new URL(details.url).pathname.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase()
  if (!/mpegurl|dash\+xml|^(video|audio)\//i.test(type) && !/^(m3u8|mpd|mp4|webm|m4s|ts|mp3|m4a|pdf|zip|srt|vtt)$/.test(suffix ?? '')) return
  if (capture.entries.some(item => item.url === details.url)) return
  let name = new URL(details.url).pathname.split('/').pop() || new URL(details.url).hostname
  try { name = decodeURIComponent(name) } catch {}
  const mediaType = /mpegurl/i.test(type) || suffix === 'm3u8' ? 'HLS'
    : /dash\+xml/i.test(type) || suffix === 'mpd' ? 'DASH' : suffix?.toUpperCase() || 'MEDIA'
  capture.entries.push({
    url: details.url, name: name.slice(0, 180), type: mediaType, headers: request.values, source: 'network',
    size: Number(details.responseHeaders?.find(header => header.name.toLowerCase() === 'content-length')?.value) || 0,
  })
  if (capture.entries.length > 150) capture.entries.shift()
  void chrome.storage.session.set({ [key(details.tabId)]: capture })
}, { urls: ['http://*/*', 'https://*/*'] }, ['responseHeaders'])

chrome.webRequest.onErrorOccurred.addListener(details => { headers.delete(details.requestId) }, { urls: ['http://*/*', 'https://*/*'] })

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'resources' || sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('sidepanel.html')) return
  void ready.then(async () => {
    const tab = await chrome.tabs.get(message.tabId)
    if (!tab.active || tab.url !== message.pageUrl) {
      respond([])
      return
    }
    await watchPage(message.tabId, message.pageUrl)
    const capture = captures.get(message.tabId)
    respond(capture && capture.url === message.pageUrl ? capture.entries : [])
  }).catch(() => respond([]))
  return true
})
