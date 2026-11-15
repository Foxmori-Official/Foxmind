import type { Summary, SummaryInput } from './summary'

export type SummaryKind = 'page' | 'selection'

export interface SummaryRecord {
  id: string
  signature: string
  url: string
  title: string
  summary: Summary
  evidence: SummaryInput['paragraphs']
  selected: boolean
  limited: boolean
  at: number
}

export interface SummaryArchive {
  generation: string
  entries: SummaryRecord[]
}

export interface ArchiveScope {
  windowId: number
  incognito: boolean
}

interface WindowSummaries extends Partial<Record<SummaryKind, string>> {
  generation: string
}

export const emptyArchive: SummaryArchive = { generation: '', entries: [] }
export const reuseFor = 30 * 60_000
export const privateArchiveKey = (windowId: number) => 'foxmind-private-summaries-' + windowId
export const windowSummariesKey = (windowId: number) => 'foxmind-current-summaries-' + windowId

export function archiveKey(scope: ArchiveScope): string {
  return scope.incognito ? privateArchiveKey(scope.windowId) : 'foxmind-summary-archive'
}

export function archiveArea(scope: ArchiveScope): 'local' | 'session' {
  return scope.incognito ? 'session' : 'local'
}

export async function readArchive(scope: ArchiveScope): Promise<SummaryArchive> {
  const key = archiveKey(scope)
  return (await chrome.storage[archiveArea(scope)].get(key))[key] ?? emptyArchive
}

export async function readWindowSummaries(scope: ArchiveScope, archive: SummaryArchive): Promise<Partial<Record<SummaryKind, SummaryRecord>>> {
  const key = windowSummariesKey(scope.windowId)
  const latest: WindowSummaries | undefined = (await chrome.storage.session.get(key))[key]
  if (latest?.generation !== archive.generation) return {}
  return {
    page: archive.entries.find(entry => entry.id === latest.page),
    selection: archive.entries.find(entry => entry.id === latest.selection),
  }
}

export async function saveSummary(
  scope: ArchiveScope, entry: SummaryRecord, generation: string, fresh: boolean, signal: AbortSignal,
): Promise<boolean> {
  const key = archiveKey(scope)
  return await navigator.locks.request(key, async () => {
    const archive = await readArchive(scope)
    if (archive.generation !== generation || signal.aborted) return false
    if (fresh) {
      const entries = [entry, ...archive.entries]
      await chrome.storage[archiveArea(scope)].set({ [key]: { generation, entries: scope.incognito ? entries.slice(0, 20) : entries } })
    } else if (!archive.entries.some(record => record.id === entry.id)) {
      return false
    }
    const currentKey = windowSummariesKey(scope.windowId)
    const saved: WindowSummaries | undefined = (await chrome.storage.session.get(currentKey))[currentKey]
    if (signal.aborted) return false
    const current = saved?.generation === generation ? saved : { generation }
    const kind: SummaryKind = entry.selected ? 'selection' : 'page'
    await chrome.storage.session.set({ [currentKey]: { ...current, [kind]: entry.id } }).catch(() => {})
    return true
  })
}

export async function deleteArchivedSummary(scope: ArchiveScope, id?: string): Promise<void> {
  const key = archiveKey(scope)
  await navigator.locks.request(key, async () => {
    const archive = await readArchive(scope)
    const next: SummaryArchive = id
      ? { ...archive, entries: archive.entries.filter(entry => entry.id !== id) }
      : { generation: crypto.randomUUID(), entries: [] }
    await chrome.storage[archiveArea(scope)].set({ [key]: next })
  })
}
